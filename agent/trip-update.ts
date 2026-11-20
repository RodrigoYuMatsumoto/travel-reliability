import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const text = z.string().trim().min(1).max(180);
const kind = z.enum([
  'order',
  'payment',
  'policy',
  'boarding_pass',
  'booking',
  'agenda',
  'confirmation',
  'route',
  'forecast',
  'inspection',
  'decision',
]);
const source = z.strictObject({
  id,
  kind,
  digest,
  observedAt: timestamp,
  expiresAt: timestamp.nullable(),
  origin: z.enum(['osrm', 'open-meteo', 'local']).optional(),
  locator: z.string().max(180).optional(),
});
const fact = z.strictObject({
  id,
  value: z.union([z.string().max(300), z.number().finite(), z.boolean(), z.null()]),
  sourceIds: z.array(id).max(12),
});
const task = z.strictObject({
  id,
  title: text,
  owner: text,
  nextAction: text,
  dueAt: timestamp.nullable(),
  critical: z.boolean(),
  state: z.enum(['open', 'done', 'risk_accepted', 'superseded']),
  requiredEvidence: z.array(kind).max(8),
  evidenceIds: z.array(id).max(16),
  watchFacts: z.array(id).max(24),
  dependsOn: z.array(id).max(24),
});
const calculation = z.strictObject({
  id,
  fromFact: id,
  toFact: id,
  minimumMinutes: z.number().int().min(0).max(10080),
  routeMinutesFact: id.optional(),
});
const inputSchema = z.strictObject({
  tripKey: id,
  at: timestamp,
  sources: z.array(source).max(1500),
  facts: z.array(fact).max(1000),
  tasks: z.array(task).max(600),
  calculations: z.array(calculation).max(600),
});

export type TripUpdateInput = z.infer<typeof inputSchema>;

function sorted<T extends { id: string }>(rows: T[]): T[] {
  const result = [...rows].sort((left, right) => left.id.localeCompare(right.id, 'en'));
  if (new Set(result.map((row) => row.id)).size !== rows.length)
    throw new Error('DUPLICATE_UPDATE_ID');
  return result;
}

export function updateDigest(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const fragmentSchema = z.object({ source, facts: z.array(fact).max(600) });

export function mergeTripFragments(input: unknown, fragments: unknown[]): TripUpdateInput {
  const result = inputSchema.parse(input);
  if (fragments.length > 12) throw new Error('TOO_MANY_UPDATE_FRAGMENTS');
  const importedFacts = new Set<string>();
  for (const raw of fragments) {
    const fragment = fragmentSchema.parse(raw);
    if (result.sources.some((item) => item.id === fragment.source.id))
      throw new Error('SOURCE_ID_REUSED');
    result.sources.push(fragment.source);
    for (const item of fragment.facts) {
      if (
        importedFacts.has(item.id) ||
        item.sourceIds.length !== 1 ||
        item.sourceIds[0] !== fragment.source.id
      )
        throw new Error('FRAGMENT_FACT_CONFLICT');
      importedFacts.add(item.id);
      const index = result.facts.findIndex((existing) => existing.id === item.id);
      if (index === -1) result.facts.push(item);
      else result.facts[index] = item;
    }
  }
  return inputSchema.parse(result);
}

export function reviewTripUpdate(raw: unknown, previous?: TripUpdateInput) {
  const input = inputSchema.parse(raw);
  const now = Date.parse(input.at);
  if (previous && (input.tripKey !== previous.tripKey || now < Date.parse(previous.at)))
    throw new Error('UPDATE_TRIP_OR_TIME_CONFLICT');
  input.sources = sorted(input.sources);
  input.facts = sorted(input.facts);
  input.tasks = sorted(input.tasks);
  input.calculations = sorted(input.calculations);
  const sources = new Map(input.sources.map((entry) => [entry.id, entry]));
  const priorSources = new Map(previous?.sources.map((entry) => [entry.id, entry]));
  for (const item of input.sources) {
    if (
      Date.parse(item.observedAt) > now ||
      (item.expiresAt && Date.parse(item.expiresAt) <= Date.parse(item.observedAt))
    )
      throw new Error('INVALID_SOURCE_TIMELINE');
    const old = priorSources.get(item.id);
    if (old && updateDigest(old) !== updateDigest(item)) throw new Error('SOURCE_ID_REUSED');
  }
  for (const sourceId of priorSources.keys()) {
    if (!sources.has(sourceId)) throw new Error('SOURCE_REMOVAL_REQUIRES_HISTORY');
  }
  const fresh = (sourceId: string) => {
    const item = sources.get(sourceId);
    if (!item) throw new Error('UNKNOWN_SOURCE_ID');
    return item.expiresAt === null || Date.parse(item.expiresAt) > now;
  };
  const facts = new Map(input.facts.map((entry) => [entry.id, entry]));
  const priorFacts = new Map(previous?.facts.map((entry) => [entry.id, entry]));
  for (const item of input.facts) {
    item.sourceIds = [...new Set(item.sourceIds)].sort();
    item.sourceIds.forEach(fresh);
    if (item.value !== null && !item.sourceIds.length) throw new Error('FACT_NEEDS_SOURCE');
  }
  const factChanges = [...new Set([...facts.keys(), ...priorFacts.keys()])]
    .filter(
      (key) => updateDigest(facts.get(key) ?? null) !== updateDigest(priorFacts.get(key) ?? null),
    )
    .sort();
  const tasks = new Map(input.tasks.map((entry) => [entry.id, entry]));
  const priorTasks = new Map(previous?.tasks.map((entry) => [entry.id, entry]));
  for (const key of priorTasks.keys()) {
    if (!tasks.has(key)) throw new Error('TASK_REMOVAL_REQUIRES_SUPERSEDED_STATUS');
  }
  const reopened: Array<{ id: string; reason: string }> = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function reviewTask(key: string) {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error('TASK_DEPENDENCY_CYCLE');
    const item = tasks.get(key);
    if (!item) throw new Error('UNKNOWN_TASK_DEPENDENCY');
    visiting.add(key);
    item.dependsOn.forEach(reviewTask);
    for (const factId of item.watchFacts) {
      if (!facts.has(factId)) throw new Error('UNKNOWN_WATCHED_FACT');
    }
    item.evidenceIds = [...new Set(item.evidenceIds)].sort();
    const activeEvidence = item.evidenceIds.filter(fresh);
    const old = priorTasks.get(key);
    const staleFact = item.watchFacts.some((factId) => {
      const watched = facts.get(factId)!;
      return (
        watched.value === null ||
        !watched.sourceIds.some((sourceId) => activeEvidence.includes(sourceId))
      );
    });
    const changedFact = item.watchFacts.some((factId) => factChanges.includes(factId));
    const newEvidence = activeEvidence.some(
      (sourceId) =>
        !old?.evidenceIds.includes(sourceId) &&
        item.requiredEvidence.includes(sources.get(sourceId)!.kind),
    );
    const kinds = new Set(activeEvidence.map((sourceId) => sources.get(sourceId)!.kind));
    if (item.state === 'superseded' || item.state === 'risk_accepted') {
      if (!kinds.has('decision')) throw new Error('TASK_DECISION_NEEDS_EVIDENCE');
    } else if (item.state === 'done') {
      let reason: string | undefined;
      if (!item.requiredEvidence.length || !item.requiredEvidence.every((type) => kinds.has(type)))
        reason = 'missing_or_expired_evidence';
      else if (item.dependsOn.some((dependency) => tasks.get(dependency)?.state !== 'done'))
        reason = 'dependency_not_done';
      else if (staleFact || (old?.state === 'done' && changedFact && !newEvidence))
        reason = 'watched_fact_changed_or_stale';
      if (reason) {
        if (old?.state !== 'done') throw new Error('TASK_CLOSURE_NEEDS_EVIDENCE: ' + reason);
        item.state = 'open';
        reopened.push({ id: key, reason });
      }
    }
    visiting.delete(key);
    visited.add(key);
  }
  input.tasks.forEach((item) => reviewTask(item.id));
  const calculations = input.calculations.map((item) => {
    const endpoints = [facts.get(item.fromFact), facts.get(item.toFact)];
    if (endpoints.includes(undefined)) throw new Error('UNKNOWN_CALCULATION_FACT');
    const route = item.routeMinutesFact ? facts.get(item.routeMinutesFact) : undefined;
    if (item.routeMinutesFact && !route) throw new Error('UNKNOWN_CALCULATION_FACT');
    const routeMinutes = !route
      ? 0
      : typeof route.value === 'number' &&
          Number.isSafeInteger(route.value) &&
          route.value >= 0 &&
          route.value <= 10080 &&
          route.sourceIds.some(
            (sourceId) => fresh(sourceId) && sources.get(sourceId)?.kind === 'route',
          )
        ? route.value
        : null;
    const requiredMinutes = routeMinutes === null ? null : item.minimumMinutes + routeMinutes;
    const moments = endpoints.map((endpoint) =>
      endpoint && endpoint.sourceIds.some(fresh) && timestamp.safeParse(endpoint.value).success
        ? Date.parse(endpoint.value as string)
        : NaN,
    );
    const availableMinutes = moments.every(Number.isFinite)
      ? Math.floor((moments[1]! - moments[0]!) / 60000)
      : null;
    return {
      ...item,
      availableMinutes,
      requiredMinutes,
      remainingMinutes:
        availableMinutes === null || requiredMinutes === null
          ? null
          : availableMinutes - requiredMinutes,
      state:
        availableMinutes === null || requiredMinutes === null
          ? 'unverified'
          : availableMinutes >= requiredMinutes
            ? 'fits'
            : 'short',
      inputsChanged: [item.fromFact, item.toFact, item.routeMinutesFact].some(
        (key) => key && factChanges.includes(key),
      ),
    };
  });
  const taskChanges = input.tasks
    .filter((item) => updateDigest(item) !== updateDigest(priorTasks.get(item.id) ?? null))
    .map((item) => ({
      id: item.id,
      before: priorTasks.get(item.id)?.state ?? null,
      after: item.state,
    }));
  const open = input.tasks.filter(
    (item) => item.state === 'open' || item.state === 'risk_accepted',
  );
  return {
    snapshot: input,
    changes: { facts: factChanges, tasks: taskChanges, reopened },
    calculations,
    counts: {
      total: input.tasks.length,
      open: open.length,
      criticalOpen: open.filter((item) => item.critical).length,
      done: input.tasks.filter((item) => item.state === 'done').length,
      superseded: input.tasks.filter((item) => item.state === 'superseded').length,
    },
  };
}
