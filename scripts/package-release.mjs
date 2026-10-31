import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { standaloneCoreOrExit } from './core-git.mjs';
// Never interpret an ancestor/host repository's HEAD as the distributable core.
const core = standaloneCoreOrExit();
const root = core.coreRoot;
const git = (args) => core.git(args).trim();
if (git(['status', '--porcelain']))
  throw new Error('Release packaging requires a clean committed tree');
execFileSync(process.execPath, [resolve(root, 'scripts/privacy-check.mjs'), '--history'], {
  cwd: root,
  stdio: 'inherit',
});
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
  commit = git(['rev-parse', 'HEAD']);
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))
  throw new Error('INVALID_RELEASE_VERSION');
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
const name = `travel-reliability-v${version}.zip`;
core.git([
  'archive',
  '--format=zip',
  `--prefix=travel-reliability-v${version}/`,
  '-o',
  resolve(root, 'artifacts', name),
  'HEAD',
]);
const hash = createHash('sha256')
  .update(readFileSync(resolve(root, 'artifacts', name)))
  .digest('hex');
writeFileSync(resolve(root, 'artifacts/SHA256SUMS'), `${hash}  ${name}\n`);
writeFileSync(
  resolve(root, 'artifacts/release-manifest.json'),
  JSON.stringify(
    {
      version,
      commit,
      artifact: name,
      sha256: hash,
      includes: 'committed source only',
      excludes:
        'runtime data, credentials, original private sources, dependency directories and Git internals',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ artifact: name, commit, sha256: hash }));
