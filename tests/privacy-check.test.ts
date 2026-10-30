import { it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

const checker = resolve('scripts/privacy-check.mjs');
const syntheticEmail = 'traveler' + '@' + 'private.invalid';

function fixture(privateParent = false) {
  const base = realpathSync(tmpdir());
  const dir = mkdtempSync(join(base, 'travel-privacy-check-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Synthetic Test',
    GIT_COMMITTER_NAME: 'Synthetic Test',
    GIT_AUTHOR_EMAIL: 'contributors@example.invalid',
    GIT_COMMITTER_EMAIL: 'contributors@example.invalid',
  };
  const git = (args: string[], email?: string) =>
    execFileSync('git', args, {
      cwd: dir,
      env: { ...env, ...(email ? { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email } : {}) },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git(['init', '--quiet']);
  writeFileSync(join(dir, 'fixture.txt'), 'Synthetic fixture only.\n');
  git(['add', 'fixture.txt']);
  git(
    [
      '-c',
      'core.hooksPath=disabled-hooks',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'Synthetic base',
    ],
    privateParent ? syntheticEmail : undefined,
  );
  const parent = git(['rev-parse', 'HEAD']);
  git([
    '-c',
    'core.hooksPath=disabled-hooks',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'Synthetic head',
  ]);
  const head = git(['rev-parse', 'HEAD']);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  const merge = git(
    [
      '-c',
      'commit.gpgsign=false',
      'commit-tree',
      tree,
      '-p',
      parent,
      '-p',
      head,
      '-m',
      `Merge ${head} into ${parent}`,
    ],
    syntheticEmail,
  );
  git(['-c', 'core.hooksPath=disabled-hooks', 'checkout', '--quiet', '--detach', merge]);
  const ci = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REF: 'refs/pull/17/merge',
    GITHUB_SHA: merge,
  };
  return {
    dir,
    merge,
    scan(overrides: Record<string, string> = {}) {
      const result = spawnSync(process.execPath, [checker, '--history'], {
        cwd: dir,
        env: { ...env, ...ci, ...overrides },
        encoding: 'utf8',
      });
      return {
        status: result.status,
        report: JSON.parse(result.status === 0 ? result.stdout : result.stderr),
      };
    },
    cleanup() {
      const target = realpathSync(dir);
      if (dirname(target) !== base || !basename(target).startsWith('travel-privacy-check-'))
        throw new Error('UNSAFE_TEST_CLEANUP');
      rmSync(target, { recursive: true });
    },
  };
}

it('excludes only validated temporary PR metadata and still rejects private file contents', () => {
  const repo = fixture();
  try {
    const passed = repo.scan();
    expect(passed.status).toBe(0);
    expect(passed.report.excludedPreviewMetadata).toBe(repo.merge.slice(0, 12));
    expect(repo.scan({ GITHUB_EVENT_NAME: 'push' }).status).toBe(1);
    expect(repo.scan({ GITHUB_SHA: '0'.repeat(40) }).status).toBe(1);
    expect(repo.scan({ GITHUB_REF: 'refs/heads/main' }).status).toBe(1);
    writeFileSync(join(repo.dir, 'fixture.txt'), syntheticEmail);
    const failed = repo.scan();
    expect(failed.status).toBe(1);
    expect(
      failed.report.findings.some(
        (finding: { file: string; rule: string }) =>
          finding.file === 'fixture.txt' && finding.rule === 'private-email',
      ),
    ).toBe(true);
  } finally {
    repo.cleanup();
  }
}, 30000);

it('continues to reject private identities in actual parent history', () => {
  const repo = fixture(true);
  try {
    const failed = repo.scan();
    expect(failed.status).toBe(1);
    expect(
      failed.report.findings.some(
        (finding: { file: string; rule: string }) =>
          finding.file.startsWith('commit:') && finding.rule === 'private-email',
      ),
    ).toBe(true);
  } finally {
    repo.cleanup();
  }
}, 30000);
