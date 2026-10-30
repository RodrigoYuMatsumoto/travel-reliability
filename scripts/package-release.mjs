import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git(['status', '--porcelain']))
  throw new Error('Release packaging requires a clean committed tree');
execFileSync(process.execPath, ['scripts/privacy-check.mjs', '--history'], { stdio: 'inherit' });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version,
  commit = git(['rev-parse', 'HEAD']);
mkdirSync('artifacts', { recursive: true });
const name = `travel-reliability-v${version}.zip`;
execFileSync('git', [
  'archive',
  '--format=zip',
  `--prefix=travel-reliability-v${version}/`,
  '-o',
  'artifacts/' + name,
  'HEAD',
]);
const hash = createHash('sha256')
  .update(readFileSync('artifacts/' + name))
  .digest('hex');
writeFileSync('artifacts/SHA256SUMS', `${hash}  ${name}\n`);
writeFileSync(
  'artifacts/release-manifest.json',
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
