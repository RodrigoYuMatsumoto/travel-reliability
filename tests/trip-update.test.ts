import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mergeTripFragments,
  reviewTripUpdate,
  type TripUpdateInput,
} from '../agent/trip-update.js';
import { tripRevision } from '../agent/trip-update-store.js';

const at = '2031-03-01T15:00:00Z';
const initial = (): TripUpdateInput => ({
  tripKey: 'synthetic-trip',
  at,
  sources: [
    { id: 'S1', kind: 'agenda', digest: 'a'.repeat(64), observedAt: at, expiresAt: null },
    { id: 'S2', kind: 'order', digest: 'b'.repeat(64), observedAt: at, expiresAt: null },
  ],
  facts: [
    { id: 'visit_end', value: '2031-03-02T10:30:00+01:00', sourceIds: ['S1'] },
    { id: 'next_visit', value: '2031-03-02T12:00:00+01:00', sourceIds: ['S1'] },
  ],
  tasks: [
    {
      id: 'agenda',
      title: 'Agenda <de trabalho>',
      owner: 'Organização',
      nextAction: 'Conferir portaria',
      dueAt: null,
      critical: true,
      state: 'done',
      requiredEvidence: ['agenda'],
      evidenceIds: ['S1'],
      watchFacts: ['visit_end'],
      dependsOn: [],
    },
    {
      id: 'driver',
      title: 'Motorista',
      owner: 'Transportador',
      nextAction: 'Conferir horários',
      dueAt: null,
      critical: true,
      state: 'done',
      requiredEvidence: ['agenda'],
      evidenceIds: ['S1'],
      watchFacts: [],
      dependsOn: ['agenda'],
    },
    {
      id: 'policy',
      title: 'Seguro',
      owner: 'Agência',
      nextAction: 'Obter apólice',
      dueAt: null,
      critical: true,
      state: 'open',
      requiredEvidence: ['policy'],
      evidenceIds: ['S2'],
      watchFacts: [],
      dependsOn: [],
    },
  ],
  calculations: [
    { id: 'travel_gap', fromFact: 'visit_end', toFact: 'next_visit', minimumMinutes: 60 },
  ],
});

describe('evidence-based revisions of a synthetic trip', () => {
  it('uses a boarding pass only for the leg it documents', () => {
    const oldInput = initial();
    oldInput.tasks = ['first', 'second'].map((leg) => ({
      id: leg,
      title: 'Conferir cartão de embarque',
      owner: 'Viajante fictício',
      nextAction: 'Vincular comprovante do próprio trecho',
      dueAt: null,
      critical: true,
      state: 'open',
      requiredEvidence: ['boarding_pass'],
      evidenceIds: [],
      watchFacts: [leg + '-gate'],
      dependsOn: [],
    }));
    oldInput.facts.push(
      { id: 'first-gate', value: null, sourceIds: [] },
      { id: 'second-gate', value: null, sourceIds: [] },
    );
    const original = reviewTripUpdate(oldInput);
    const input = mergeTripFragments(original.snapshot, [
      {
        source: {
          id: 'S3',
          kind: 'boarding_pass',
          digest: 'c'.repeat(64),
          observedAt: at,
          expiresAt: null,
        },
        facts: [{ id: 'first-gate', value: 'G2', sourceIds: ['S3'] }],
      },
    ]);
    Object.assign(input.tasks[0]!, { state: 'done', evidenceIds: ['S3'] });
    expect(reviewTripUpdate(input, original.snapshot).counts).toMatchObject({
      done: 1,
      criticalOpen: 1,
    });
    Object.assign(input.tasks[1]!, { state: 'done', evidenceIds: ['S3'] });
    expect(() => reviewTripUpdate(input, original.snapshot)).toThrow('TASK_CLOSURE_NEEDS_EVIDENCE');
  });
  it('uses the explicit new agenda source and rejects ambiguous imported facts', () => {
    const old = reviewTripUpdate(initial());
    const fragment = {
      source: { ...old.snapshot.sources[0]!, id: 'S3', digest: 'c'.repeat(64), locator: 'Current' },
      facts: [{ id: 'visit_end', value: '2031-03-02T11:35:00+01:00', sourceIds: ['S3'] }],
    };
    const next = mergeTripFragments(old.snapshot, [fragment]);
    expect(reviewTripUpdate(next, old.snapshot).changes.reopened).toHaveLength(2);
    const duplicate = { ...fragment, source: { ...fragment.source, id: 'S4' } };
    expect(() => mergeTripFragments(old.snapshot, [fragment, duplicate])).toThrow(
      'FRAGMENT_FACT_CONFLICT',
    );
  });
  it('reopens affected work, recalculates the connection and keeps the request pending', () => {
    const old = reviewTripUpdate(initial());
    const next = structuredClone(old.snapshot);
    next.sources.push({ ...next.sources[0]!, id: 'S3', digest: 'c'.repeat(64) });
    const meeting = next.facts.find((item) => item.id === 'visit_end')!;
    meeting.value = '2031-03-02T11:35:00+01:00';
    meeting.sourceIds = ['S3'];
    const result = reviewTripUpdate(next, old.snapshot);
    expect(result.calculations[0]).toMatchObject({
      availableMinutes: 25,
      remainingMinutes: -35,
      state: 'short',
    });
    expect(result.changes.reopened.map((item) => item.id)).toEqual(['agenda', 'driver']);
    expect(result.counts).toMatchObject({ open: 3, criticalOpen: 3 });
    next.tasks.find((item) => item.id === 'policy')!.state = 'done';
    expect(() => reviewTripUpdate(next, old.snapshot)).toThrow('TASK_CLOSURE_NEEDS_EVIDENCE');
  });

  it('reopens work when supporting evidence expires and leaves the calculation unknown', () => {
    const original = initial();
    original.sources[0]!.expiresAt = '2031-03-02T00:00:00Z';
    const old = reviewTripUpdate(original);
    const next = { ...old.snapshot, at: '2031-03-02T00:00:00Z' };
    const update = reviewTripUpdate(next, old.snapshot);
    expect(update.calculations[0]).toMatchObject({ state: 'unverified', availableMinutes: null });
    expect(update.changes.reopened).toHaveLength(2);
  });

  it.each(['risk_accepted', 'superseded'] as const)(
    'reopens a %s task when its decision expires instead of rejecting the update',
    (state) => {
      const original = initial();
      original.sources.push({
        id: 'D1',
        kind: 'decision',
        digest: 'd'.repeat(64),
        observedAt: at,
        expiresAt: '2031-03-02T00:00:00Z',
      });
      Object.assign(original.tasks[2]!, { state, evidenceIds: ['D1', 'S2'] });
      const old = reviewTripUpdate(original);
      expect(old.snapshot.tasks[2]!.state).toBe(state);

      const later = reviewTripUpdate({ ...old.snapshot, at: '2031-03-02T00:00:00Z' }, old.snapshot);
      expect(later.changes.reopened).toEqual([
        { id: 'policy', reason: 'decision_missing_or_expired' },
      ]);
      expect(later.snapshot.tasks.find((item) => item.id === 'policy')!.state).toBe('open');
      expect(later.counts).toMatchObject({ open: 1, criticalOpen: 1, superseded: 0 });

      const retry = structuredClone(later.snapshot);
      retry.tasks.find((item) => item.id === 'policy')!.state = state;
      expect(() => reviewTripUpdate(retry, later.snapshot)).toThrow('TASK_DECISION_NEEDS_EVIDENCE');
    },
  );

  it('keeps revisions immutable and rejects concurrent promotion from the same preview', async () => {
    const root = await mkdtemp(join(tmpdir(), 'trip-update-'));
    try {
      const input = initial();
      input.tasks[0]!.state = 'open';
      input.tasks[1]!.state = 'open';
      const preview = await tripRevision(root, input);
      expect(await readdir(root)).toEqual([]);
      const digest = preview.version!.digest;
      const attempts = await Promise.allSettled([
        tripRevision(root, input, digest),
        tripRevision(root, input, digest),
      ]);
      expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const current = await tripRevision(root);
      expect(current.version?.digest).toBe(digest);
      const first = join(root, 'revision_00000001');
      expect(await readFile(join(first, 'painel.html'), 'utf8')).toContain('&lt;de trabalho&gt;');
      expect(JSON.parse(await readFile(join(first, 'checklist.json'), 'utf8')).revision).toBe(
        digest,
      );
      const next = structuredClone(input);
      next.tasks[0]!.owner = 'Novo responsável';
      const second = await tripRevision(root, next);
      await tripRevision(root, next, second.version!.digest);
      expect((await tripRevision(root)).version?.parent).toBe(digest);
      expect(await readFile(join(first, 'revision.json'), 'utf8')).toContain(digest);
      const active = join(root, 'revision_00000002', 'revision.json');
      const stored = await readFile(active, 'utf8');
      expect(stored).toContain('Novo responsável');
      await writeFile(active, stored.replace('Novo responsável', 'Alterado fora do controle'));
      await expect(tripRevision(root)).rejects.toThrow('UPDATE_REVISION_INTEGRITY');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
