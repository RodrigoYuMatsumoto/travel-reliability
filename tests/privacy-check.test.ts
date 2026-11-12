import { it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, realpathSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

const sourceScripts = resolve('scripts');
const syntheticEmail = 'traveler' + '@' + 'private.invalid';

function fixture(privateParent = false) {
  const base = realpathSync(tmpdir());
  const dir = mkdtempSync(join(base, 'travel-privacy-check-'));
  mkdirSync(join(dir, 'scripts'));
  for (const file of ['privacy-check.mjs', 'core-git.mjs'])
    copyFileSync(join(sourceScripts, file), join(dir, 'scripts', file));
  const checker = join(dir, 'scripts/privacy-check.mjs');
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
    parent,
    head,
    tree,
    env,
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

const platformCommitterEmail = ['noreply', 'github.com'].join('@');
const platformBotEmail = ['49699333+dependabot[bot]', 'users.noreply.github.com'].join('@');
const platformBotTrailer = ['Signed-off-by: dependabot[bot] <support', 'github.com>'].join('@');

function platformBotFixture(
  options: {
    authorName?: string;
    authorEmail?: string;
    committerName?: string;
    committerEmail?: string;
    subject?: string;
    message?: string;
    parentCount?: number;
    committedBlob?: string;
  } = {},
) {
  const repo = fixture();
  const git = (args: string[], env = repo.env) =>
    execFileSync('git', args, {
      cwd: repo.dir,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  let tree = repo.tree;
  if (options.committedBlob !== undefined) {
    writeFileSync(join(repo.dir, 'fixture.txt'), options.committedBlob);
    git(['add', 'fixture.txt']);
    tree = git(['write-tree']);
  }
  const parentArguments =
    options.parentCount === 0
      ? []
      : options.parentCount === 2
        ? ['-p', repo.head, '-p', repo.parent]
        : ['-p', repo.head];
  const commit = git(
    [
      '-c',
      'commit.gpgsign=false',
      'commit-tree',
      tree,
      ...parentArguments,
      '-m',
      (options.subject ?? 'build(deps): bump synthetic-dependency from 1.0.0 to 1.0.1') +
        '\n\n' +
        (options.message ?? platformBotTrailer),
    ],
    {
      ...repo.env,
      GIT_AUTHOR_NAME: options.authorName ?? 'dependabot[bot]',
      GIT_AUTHOR_EMAIL: options.authorEmail ?? platformBotEmail,
      GIT_COMMITTER_NAME: options.committerName ?? 'GitHub',
      GIT_COMMITTER_EMAIL: options.committerEmail ?? platformCommitterEmail,
    },
  );
  git(['-c', 'core.hooksPath=disabled-hooks', 'checkout', '--quiet', '--detach', commit]);
  return {
    ...repo,
    commit,
    scan(overrides: Record<string, string> = {}) {
      return repo.scan({ GITHUB_EVENT_NAME: 'push', GITHUB_SHA: commit, ...overrides });
    },
  };
}

it('classifies only exact shared platform fields without claiming authenticated bot identity', () => {
  const repo = platformBotFixture();
  try {
    const passed = repo.scan();
    expect(passed.status).toBe(0);
    expect(passed.report.classifiedPlatformServiceFields).toEqual({
      committerEmailFields: 1,
      exactBotTrailerLines: 1,
      identityVerification: 'not_performed',
    });
    // Other rules still inspect the original bot metadata, not the email projection.
    expect(repo.scan({ PRIVACY_DENY_TERMS: 'dependabot' }).status).toBe(1);
    writeFileSync(join(repo.dir, 'fixture.txt'), platformCommitterEmail);
    const failed = repo.scan();
    expect(failed.status).toBe(1);
    expect(failed.report.findings).toContainEqual({
      file: 'fixture.txt',
      rule: 'private-email',
    });
  } finally {
    repo.cleanup();
  }
}, 30000);

it('classifies the exact dependency-dev subject format as the same bounded platform profile', () => {
  const repo = platformBotFixture({
    subject: 'build(deps-dev): bump synthetic-dev-dependency from 1.0.0 to 1.0.1',
  });
  try {
    const passed = repo.scan();
    expect(passed.status).toBe(0);
    expect(passed.report.classifiedPlatformServiceFields).toMatchObject({
      committerEmailFields: 1,
      exactBotTrailerLines: 1,
      identityVerification: 'not_performed',
    });
  } finally {
    repo.cleanup();
  }
}, 30000);

it.each([
  { authorName: 'Synthetic Human', authorEmail: syntheticEmail },
  { authorEmail: syntheticEmail },
  { authorEmail: ['999+dependabot[bot]', 'users.noreply.github.com'].join('@') },
  { committerName: 'Synthetic Platform' },
  { committerEmail: syntheticEmail },
  { committerEmail: ['noreply', 'github.com.attacker.invalid'].join('@') },
  { subject: 'Other Bump synthetic dependency' },
  { subject: 'Bump' },
  { subject: 'Bump synthetic-dependency from 1.0.0 to 1.0.1' },
  { subject: 'feat(deps): bump synthetic-dependency' },
  { subject: 'build(other): bump synthetic-dependency' },
  { subject: 'build(deps-prod): bump synthetic-dependency' },
  { subject: 'build(deps): Bump synthetic-dependency' },
  { subject: 'build(deps): bump ' },
  { subject: 'prefix build(deps): bump synthetic-dependency' },
  { parentCount: 0 },
  { parentCount: 2 },
])(
  'rejects a platform metadata exception with a changed identity or commit shape %#',
  (options) => {
    const repo = platformBotFixture(options);
    try {
      expect(repo.scan().status).toBe(1);
    } finally {
      repo.cleanup();
    }
  },
  30000,
);

it.each([
  platformBotTrailer + '\nSigned-off-by: Synthetic fixture <' + syntheticEmail + '>',
  platformBotTrailer + '\nContact ' + syntheticEmail,
  syntheticEmail + '\n' + platformBotTrailer,
  'Prefix ' + platformBotTrailer,
  platformBotTrailer + ' suffix',
  platformBotTrailer + '\n' + platformBotTrailer,
])(
  'keeps message emails outside one exact bot trailer in scope %#',
  (message) => {
    const repo = platformBotFixture({ message });
    try {
      expect(repo.scan().status).toBe(1);
    } finally {
      repo.cleanup();
    }
  },
  30000,
);

it('still scans private historical blobs on bot-shaped commits after the current copy is clean', () => {
  const repo = platformBotFixture({ committedBlob: syntheticEmail });
  try {
    writeFileSync(join(repo.dir, 'fixture.txt'), 'Synthetic fixture only.\n');
    const failed = repo.scan();
    expect(failed.status).toBe(1);
    expect(failed.report.findings).toContainEqual({
      file: 'history:fixture.txt',
      rule: 'private-email',
    });
  } finally {
    repo.cleanup();
  }
}, 30000);

it('matches the local account name unless a letter touches it, not inside longer public names', () => {
  const repo = fixture();
  try {
    // The committed fixture and author contain "Synthetic"; a substring match would fail here.
    expect(repo.scan({ USERNAME: 'synth' }).status).toBe(0);
    writeFileSync(join(repo.dir, 'fixture.txt'), 'Local account: SYNTH\n');
    const failed = repo.scan({ USERNAME: 'synth' });
    expect(failed.status).toBe(1);
    expect(failed.report.findings).toContainEqual({
      file: 'fixture.txt',
      rule: 'operator-deny-term',
    });

    // Adjacent digits or underscores do not hide the account name.
    writeFileSync(join(repo.dir, 'fixture.txt'), 'Backup folder: synth_2026\n');
    expect(repo.scan({ USERNAME: 'synth' }).status).toBe(1);
    writeFileSync(join(repo.dir, 'fixture.txt'), 'Synthetic fixture only.\n');
    // Explicit operator terms keep substring matching.
    expect(repo.scan({ USERNAME: 'synth', PRIVACY_DENY_TERMS: 'synthet' }).status).toBe(1);
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

it('does not extend reserved example-domain exceptions to longer email domains', () => {
  const repo = fixture();
  try {
    for (const domain of [
      'example.invalid.attacker.invalid',
      'example.com-attacker.invalid',
      'localhost.attacker.invalid',
    ]) {
      writeFileSync(join(repo.dir, 'fixture.txt'), 'synthetic' + '@' + domain);
      const failed = repo.scan();
      expect(failed.status).toBe(1);
      expect(
        failed.report.findings.some((item: { rule: string }) => item.rule === 'private-email'),
      ).toBe(true);
    }
    for (const domain of ['example.invalid', 'example.com', 'example.org']) {
      writeFileSync(join(repo.dir, 'fixture.txt'), 'synthetic' + '@' + domain);
      expect(repo.scan().status).toBe(0);
    }
  } finally {
    repo.cleanup();
  }
}, 30000);
