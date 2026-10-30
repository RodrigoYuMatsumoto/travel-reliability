import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';

// Defense in depth, not a proof of anonymization. Only tracked/unignored project files.
const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const extraTerms = (process.env.PRIVACY_DENY_TERMS ?? '')
  .split('|')
  .filter((term) => term.length >= 3);
const username = process.env.USERNAME;
if (username && !['runner', 'root', 'node', 'parser'].includes(username.toLowerCase()))
  extraTerms.push(username);
const forbiddenPaths =
  /(?:^|\/)(?:\.env(?!\.example$)|\.local|\.venv|node_modules|test-results|playwright-report|credentials|private)(?:\/|$)|\.(?:trb|pdf|docx|eml|vcf|pem|key|p12|pfx)$/i;
const rules = [
  ['private-path', /[A-Z]:[\\/](?:Users|Meu Drive)[\\/]|\/Users\/[^/\s]+\//i],
  [
    'credential',
    /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/,
  ],
  ['identifier', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  [
    'private-email',
    /\b[A-Z0-9._%+-]+@(?!example\.(?:invalid|com|org)|localhost)[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  ],
];
const failures = [];
function scan(text, label) {
  for (const [name, pattern] of rules)
    if (pattern.test(text)) failures.push({ file: label, rule: name });
  if (extraTerms.some((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase())))
    failures.push({ file: label, rule: 'operator-deny-term' });
}
for (const file of new Set(files)) {
  if (forbiddenPaths.test(file) || lstatSync(file).isSymbolicLink()) {
    failures.push({ file, rule: 'forbidden-artifact' });
    continue;
  }
  const data = readFileSync(file);
  if (data.includes(0)) {
    if (!/^web\/public\/icon-(192|512)\.png$/.test(file))
      failures.push({ file, rule: 'unexpected-binary' });
    continue;
  }
  scan(data.toString('utf8'), file);
}
if (process.argv.includes('--history')) {
  const commits = execFileSync('git', ['rev-list', '--all'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  const seen = new Set();
  for (const commit of commits) {
    scan(
      execFileSync('git', ['show', '-s', '--format=%an%n%ae%n%cn%n%ce%n%B', commit], {
        encoding: 'utf8',
      }),
      `commit:${commit.slice(0, 12)}`,
    );
    const entries = execFileSync('git', ['ls-tree', '-r', '-z', commit], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    for (const entry of entries) {
      const [header, path] = entry.split('\t'),
        hash = header.split(' ')[2];
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      const data = execFileSync('git', ['cat-file', 'blob', hash], { maxBuffer: 8 * 1024 * 1024 });
      if (!data.includes(0)) scan(data.toString('utf8'), `history:${path}`);
    }
  }
}
if (failures.length) {
  process.stderr.write(JSON.stringify({ status: 'FAIL', findings: failures }, null, 2) + '\n');
  process.exitCode = 1;
} else
  process.stdout.write(
    JSON.stringify({
      status: 'PASS',
      files: new Set(files).size,
      history: process.argv.includes('--history'),
      scope: 'heuristic scan; manual review still required',
    }) + '\n',
  );
