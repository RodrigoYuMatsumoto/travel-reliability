import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const runnerUrl = new URL('../scripts/test-isolated.mjs', import.meta.url).href;
const { createTestIsolation, cleanupTestIsolation, inspectTemporaryRoot } = await import(runnerUrl);
const coreGitUrl = new URL('../scripts/core-git.mjs', import.meta.url).href;
const { getCoreGitContext } = await import(coreGitUrl);
const bases: string[] = [];
const prefix = 'travel-isolation-regression-';

function fixture() {
  const parent = realpathSync(tmpdir());
  const base = mkdtempSync(join(parent, prefix));
  bases.push(base);
  const normal = join(base, 'normal');
  const worktree = join(base, 'synthetic-worktree');
  const fallback = join(base, 'fallback');
  mkdirSync(normal);
  mkdirSync(worktree);
  mkdirSync(join(worktree, '.git'));
  mkdirSync(fallback);
  return { base, normal, worktree, fallback };
}

afterEach(() => {
  const parent = realpathSync(tmpdir());
  for (const base of bases.splice(0)) {
    const actual = realpathSync(base);
    if (dirname(actual) !== parent || !basename(actual).startsWith(prefix))
      throw new Error('UNSAFE_ISOLATION_TEST_CLEANUP');
    rmSync(actual, { recursive: true, force: false });
  }
});

describe('scoped test temporary directories', () => {
  it('uses OS TEMP when it has no Git ancestor and changes only child variables', () => {
    const { normal, fallback } = fixture();
    const before = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    const input = { SYNTHETIC_ONLY: 'fixture' };
    const isolation = createTestIsolation({
      environment: input,
      defaultRoot: normal,
      fallbackRoot: fallback,
    });
    expect(isolation.source).toBe('os-temp');
    expect(isolation.environment.TEMP).toBe(isolation.root);
    expect(isolation.environment.TMP).toBe(isolation.root);
    expect(isolation.environment.TMPDIR).toBe(isolation.root);
    expect(input).toEqual({ SYNTHETIC_ONLY: 'fixture' });
    expect({ TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }).toEqual(
      before,
    );
    const root = isolation.root;
    cleanupTestIsolation(isolation);
    expect(existsSync(root)).toBe(false);
  });

  it('falls back from invalid Git ancestry without reading or changing repository contents', () => {
    const { worktree, fallback } = fixture();
    const marker = join(worktree, '.git', 'synthetic-sentinel');
    writeFileSync(marker, 'synthetic repository metadata');
    const isolation = createTestIsolation({
      environment: {},
      defaultRoot: join(worktree, 'nested', 'temp'),
      fallbackRoot: fallback,
    });
    expect(isolation.source).toBe('project-volume');
    expect(dirname(isolation.root)).toBe(realpathSync(fallback));
    expect(readFileSync(marker, 'utf8')).toBe('synthetic repository metadata');
    expect(existsSync(join(worktree, 'nested'))).toBe(false);
    cleanupTestIsolation(isolation);
  });

  it('rejects an unsafe explicit override instead of silently ignoring it', () => {
    const { normal, worktree, fallback } = fixture();
    expect(() =>
      createTestIsolation({
        environment: { TRAVEL_TEST_TEMP_ROOT: worktree },
        defaultRoot: normal,
        fallbackRoot: fallback,
      }),
    ).toThrow('TRAVEL_TEST_TEMP_ROOT_UNSAFE');
    expect(() => inspectTemporaryRoot('relative-temp')).toThrow('TEST_TEMP_ROOT_INVALID');
  });

  it('fails actionably when every candidate belongs to a Git worktree', () => {
    const { worktree } = fixture();
    expect(() =>
      createTestIsolation({
        environment: {},
        defaultRoot: join(worktree, 'first'),
        fallbackRoot: join(worktree, 'second'),
      }),
    ).toThrow('TEST_TEMP_UNAVAILABLE_SET_TRAVEL_TEST_TEMP_ROOT_OUTSIDE_GIT');
  });

  it('keeps synthetic fixture worktrees normal and supports LF/CRLF fixture contents', () => {
    const { normal, fallback } = fixture();
    const isolation = createTestIsolation({
      environment: {},
      defaultRoot: normal,
      fallbackRoot: fallback,
    });
    try {
      const gitEnvironment = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
      );
      Object.assign(gitEnvironment, {
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      });
      const ownRepo = join(isolation.root, 'fixture-repository');
      mkdirSync(ownRepo);
      const result = spawnSync('git', ['init', '--quiet', '--template=', ownRepo], {
        env: gitEnvironment,
        encoding: 'utf8',
        windowsHide: true,
        shell: false,
      });
      expect(result.status).toBe(0);
      expect(getCoreGitContext(ownRepo).embedded).toBe(false);
      for (const [name, value] of [
        ['lf.txt', 'synthetic\n'],
        ['crlf.txt', 'synthetic\r\n'],
      ]) {
        writeFileSync(join(ownRepo, name!), value!);
        expect(readFileSync(join(ownRepo, name!), 'utf8')).toBe(value);
      }
      const nonRepo = join(isolation.root, 'not-a-repository');
      mkdirSync(nonRepo);
      expect(() => getCoreGitContext(nonRepo)).toThrow('CORE_GIT_UNAVAILABLE');
    } finally {
      cleanupTestIsolation(isolation);
    }
  });

  it('never cleans a forged target or a run whose ownership marker changed', () => {
    const { normal, fallback } = fixture();
    expect(() => cleanupTestIsolation({ root: normal })).toThrow('TEST_TEMP_CLEANUP_NOT_OWNED');
    const isolation = createTestIsolation({
      environment: {},
      defaultRoot: normal,
      fallbackRoot: fallback,
    });
    const marker = join(isolation.root, '.travel-test-owner');
    const expected = readFileSync(marker);
    writeFileSync(marker, 'changed synthetic marker');
    expect(() => cleanupTestIsolation(isolation)).toThrow('TEST_TEMP_CLEANUP_SCOPE_REJECTED');
    expect(existsSync(normal)).toBe(true);
    writeFileSync(marker, expected);
    cleanupTestIsolation(isolation);
  });
});
