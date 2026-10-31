import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const sourceScripts = resolve('scripts');
const scriptNames = [
  'core-git.mjs',
  'privacy-check.mjs',
  'package-agent.mjs',
  'package-release.mjs',
];
const secretMarker = ['OUTSIDE', 'CORE', 'SENTINEL'].join('_');
const syntheticEmail = ['traveler', 'private.invalid'].join('@');

// Inspect standard ZIP directory names without extracting or executing content.
function zipPaths(bytes: Buffer) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > bytes.length) throw new Error('INVALID_SYNTHETIC_ZIP');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw new Error('INVALID_SYNTHETIC_ZIP');
    const nameBytes = bytes.readUInt16LE(offset + 28);
    const extraBytes = bytes.readUInt16LE(offset + 30);
    const commentBytes = bytes.readUInt16LE(offset + 32);
    names.push(bytes.subarray(offset + 46, offset + 46 + nameBytes).toString('utf8'));
    offset += 46 + nameBytes + extraBytes + commentBytes;
  }
  return names;
}
function fixture(embedded: boolean) {
  const temporaryRoot = realpathSync(tmpdir());
  const container = mkdtempSync(join(temporaryRoot, 'travel-core-git-'));
  const host = join(container, 'host');
  const core = embedded ? join(host, 'ecosystem', 'travel-reliability') : join(container, 'core');
  const external = join(container, 'external');
  mkdirSync(join(core, 'scripts'), { recursive: true });
  mkdirSync(host, { recursive: true });
  mkdirSync(external);
  for (const file of scriptNames)
    copyFileSync(join(sourceScripts, file), join(core, 'scripts', file));
  writeFileSync(join(core, 'fixture.txt'), 'Only synthetic core content.\n');
  writeFileSync(join(core, '.gitignore'), 'artifacts/\n');
  writeFileSync(
    join(core, 'package.json'),
    JSON.stringify({ name: 'synthetic-core', version: '0.4.0' }) + '\n',
  );
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Synthetic Test',
    GIT_COMMITTER_NAME: 'Synthetic Test',
    GIT_AUTHOR_EMAIL: 'contributors@example.invalid',
    GIT_COMMITTER_EMAIL: 'contributors@example.invalid',
    PRIVACY_DENY_TERMS: secretMarker,
  };
  // A caller's inherited test/worktree Git overrides must not affect fixtures.
  for (const key of Object.keys(env))
    if (
      key.startsWith('GIT_') &&
      ![
        'GIT_AUTHOR_NAME',
        'GIT_COMMITTER_NAME',
        'GIT_AUTHOR_EMAIL',
        'GIT_COMMITTER_EMAIL',
      ].includes(key)
    )
      delete (env as Record<string, string | undefined>)[key];
  const git = (cwd: string, args: string[]) =>
    execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const initialize = (cwd: string) => {
    git(cwd, ['init', '--quiet']);
    git(cwd, ['add', '.']);
    git(cwd, [
      '-c',
      'core.hooksPath=disabled-hooks',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'Synthetic source only',
    ]);
  };
  writeFileSync(join(host, 'outside-sentinel.txt'), secretMarker + ' ' + syntheticEmail + '\n');
  if (embedded) initialize(host);
  else {
    initialize(core);
    initialize(host);
  }
  const execute = (
    script: string,
    args: string[] = [],
    cwd = core,
    overrides: Record<string, string> = {},
  ) =>
    spawnSync(process.execPath, [join(core, 'scripts', script), ...args], {
      cwd,
      env: { ...env, ...overrides },
      encoding: 'utf8',
    });
  return {
    container,
    core,
    host,
    external,
    git,
    execute,
    cleanup() {
      const target = realpathSync(container);
      if (dirname(target) !== temporaryRoot || !basename(target).startsWith('travel-core-git-'))
        throw new Error('UNSAFE_TEST_CLEANUP');
      rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

describe('core Git boundary for distribution and privacy', () => {
  it.each(['package-agent.mjs', 'package-release.mjs'])(
    'refuses %s in a subtree before package or privacy side effects',
    (script) => {
      const repo = fixture(true);
      try {
        // If a packager reaches this subprocess before the boundary, it leaves proof.
        writeFileSync(
          join(repo.core, 'scripts/privacy-check.mjs'),
          "import{writeFileSync}from'node:fs';writeFileSync(new URL('../PRIVACY_INVOKED',import.meta.url),'unsafe');\n",
        );
        for (const cwd of [repo.host, repo.external]) {
          const result = repo.execute(script, [], cwd);
          expect(result.status).toBe(1);
          expect(result.stdout).toBe('');
          expect(JSON.parse(result.stderr)).toEqual({
            status: 'FAIL',
            error: 'CORE_GIT_STANDALONE_REQUIRED',
          });
          expect(result.stderr).not.toContain(repo.container);
          expect(result.stderr).not.toContain(secretMarker);
        }
        expect(existsSync(join(repo.core, 'PRIVACY_INVOKED'))).toBe(false);
        expect(existsSync(join(repo.core, 'artifacts'))).toBe(false);
        expect(existsSync(join(repo.host, 'artifacts'))).toBe(false);
      } finally {
        repo.cleanup();
      }
    },
  );

  it('scans only the current core prefix regardless of caller cwd', () => {
    const repo = fixture(true);
    try {
      for (const cwd of [repo.core, repo.host, repo.external]) {
        const result = repo.execute('privacy-check.mjs', [], cwd);
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          status: 'PASS',
          embedded: true,
          history: false,
        });
        expect(result.stdout).not.toContain(secretMarker);
        expect(result.stdout).not.toContain(repo.container);
      }
      writeFileSync(join(repo.core, 'inside.txt'), syntheticEmail);
      const failed = repo.execute('privacy-check.mjs', [], repo.external);
      expect(failed.status).toBe(1);
      expect(JSON.parse(failed.stderr).findings).toEqual(
        expect.arrayContaining([{ file: 'inside.txt', rule: 'private-email' }]),
      );
      expect(failed.stderr).not.toContain('outside-sentinel');
    } finally {
      repo.cleanup();
    }
  });

  it('refuses embedded history before inspecting host files or identities', () => {
    const repo = fixture(true);
    try {
      const result = repo.execute('privacy-check.mjs', ['--history'], repo.external);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(JSON.parse(result.stderr)).toEqual({
        status: 'FAIL',
        error: 'CORE_GIT_HISTORY_REQUIRES_STANDALONE',
      });
      expect(result.stderr).not.toContain(repo.container);
      expect(result.stderr).not.toContain(syntheticEmail);
    } finally {
      repo.cleanup();
    }
  });

  it('does not let inherited Git overrides redirect a subtree into a foreign checkout', () => {
    const repo = fixture(true);
    const independent = fixture(false);
    try {
      const overrides = {
        GIT_DIR: join(independent.core, '.git'),
        GIT_WORK_TREE: independent.core,
      };
      const result = repo.execute('package-release.mjs', [], repo.external, overrides);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr).error).toBe('CORE_GIT_STANDALONE_REQUIRED');
      expect(existsSync(join(repo.core, 'artifacts'))).toBe(false);
      expect(existsSync(join(independent.core, 'artifacts'))).toBe(false);
    } finally {
      repo.cleanup();
      independent.cleanup();
    }
  });

  it('anchors a standalone source package to its own HEAD when cwd belongs to another Git', () => {
    const repo = fixture(false);
    try {
      const expected = repo.git(repo.core, ['rev-parse', 'HEAD']);
      const result = repo.execute('package-release.mjs', [], repo.host);
      expect(result.status, result.stderr).toBe(0);
      const manifest = JSON.parse(
        readFileSync(join(repo.core, 'artifacts/release-manifest.json'), 'utf8'),
      );
      expect(manifest.commit).toBe(expected);
      expect(manifest.artifact).toBe('travel-reliability-v0.4.0.zip');
      expect(existsSync(join(repo.host, 'artifacts'))).toBe(false);
      const entries = zipPaths(readFileSync(join(repo.core, 'artifacts', manifest.artifact)));
      const prefix = 'travel-reliability-v0.4.0/';
      expect(entries.filter((name) => !name.endsWith('/')).sort()).toEqual(
        repo
          .git(repo.core, ['ls-tree', '-r', '--name-only', 'HEAD'])
          .split('\n')
          .map((name) => prefix + name)
          .sort(),
      );
      expect(entries.some((name) => name.includes('outside-sentinel'))).toBe(false);
      expect(result.stdout).not.toContain(secretMarker);
    } finally {
      repo.cleanup();
    }
  });

  it.each(['/Users/', '/users/', 'file:///Users/'])(
    'still detects an absolute home path %s while accepting the fixed Gmail API URL',
    (prefix) => {
      const repo = fixture(false);
      try {
        writeFileSync(
          join(repo.core, 'fixture.txt'),
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/example?format=raw\n',
        );
        expect(repo.execute('privacy-check.mjs').status).toBe(0);
        writeFileSync(join(repo.core, 'fixture.txt'), prefix + 'synthetic' + '/document.txt\n');
        const result = repo.execute('privacy-check.mjs');
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stderr).findings).toEqual(
          expect.arrayContaining([{ file: 'fixture.txt', rule: 'private-path' }]),
        );
      } finally {
        repo.cleanup();
      }
    },
  );
});
