import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { getCoreGitContext, CoreGitError, coreGitFailure } from './core-git.mjs';

function main() {
  // Anchor to this installed core, even when the caller's cwd is another project.
  // An embedding may scan its current prefix, never the host repository history.
  const core = getCoreGitContext();
  const history = process.argv.includes('--history');
  if (history && core.embedded) throw new CoreGitError('CORE_GIT_HISTORY_REQUIRES_STANDALONE');
  const git = (args, options = {}) => core.git(args, { repository: true, ...options });
  const pathspec = `:(literal)${core.prefix ? core.prefix + '/' : '.'}`;
  const files = git([
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--full-name',
    '--',
    pathspec,
  ])
    .split('\0')
    .filter(Boolean)
    .map((file) => {
      if (core.prefix) {
        if (!file.startsWith(core.prefix + '/')) throw new CoreGitError('CORE_GIT_SCOPE_REJECTED');
        file = file.slice(core.prefix.length + 1);
      }
      if (
        isAbsolute(file) ||
        file.includes('\\') ||
        file.split('/').some((part) => ['.', '..', ''].includes(part))
      )
        throw new CoreGitError('CORE_GIT_SCOPE_REJECTED');
      return file;
    });
  if (!files.length) throw new CoreGitError('CORE_GIT_NO_SCOPED_FILES');
  const extraTerms = (process.env.PRIVACY_DENY_TERMS ?? '')
    .split('|')
    .filter((term) => term.length >= 3);
  // The local account name is an implicit heuristic, not an operator choice. Match it
  // only where no letter touches either side, so a short account name cannot collide
  // with longer public names, such as the repository owner in attribution URLs.
  // Adjacent digits, underscores or punctuation still match. Explicit
  // PRIVACY_DENY_TERMS keep substring matching.
  const username = process.env.USERNAME;
  const escapedUsername = username?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const accountName =
    username && !['runner', 'root', 'node', 'parser'].includes(username.toLowerCase())
      ? new RegExp(`(?<!\\p{L})${escapedUsername}(?!\\p{L})`, 'iu')
      : null;
  const forbiddenPaths =
    /(?:^|\/)(?:\.env(?!\.example$)|\.local|\.venv|node_modules|test-results|playwright-report|credentials|private)(?:\/|$)|\.(?:trb|pdf|docx|eml|vcf|pem|key|p12|pfx)$/i;
  const rules = [
    [
      'private-path',
      /[A-Z]:[\\/](?:Users|Meu Drive)[\\/]|(?:^|[\s"'`=(<:])(?:file:\/\/)?\/Users\/[^/\s]+\//i,
    ],
    [
      'credential',
      /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/,
    ],
    ['identifier', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
    [
      'private-email',
      /\b[A-Z0-9._%+-]+@(?!(?:example\.(?:invalid|com|org)|localhost)(?![A-Z0-9.-]))[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    ],
  ];
  const failures = [];
  function scan(text, label, privateEmailView = text) {
    for (const [name, pattern] of rules)
      if (pattern.test(name === 'private-email' ? privateEmailView : text))
        failures.push({ file: label, rule: name });
    if (
      extraTerms.some((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase())) ||
      accountName?.test(text)
    )
      failures.push({ file: label, rule: 'operator-deny-term' });
  }
  for (const file of new Set(files)) {
    const target = resolve(core.coreRoot, file);
    if (
      forbiddenPaths.test(file) ||
      file.split('/').some((part) => part.startsWith('.env') && part !== '.env.example')
    ) {
      failures.push({ file, rule: 'forbidden-artifact' });
      continue;
    }
    let data;
    try {
      const info = lstatSync(target);
      const rel = relative(core.coreRoot, realpathSync(target));
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        isAbsolute(rel) ||
        rel === '..' ||
        rel.startsWith('..' + sep)
      ) {
        failures.push({ file, rule: 'forbidden-artifact' });
        continue;
      }
      data = readFileSync(target);
    } catch {
      failures.push({ file, rule: 'unreadable-artifact' });
      continue;
    }
    if (data.includes(0)) {
      if (!/^web\/public\/icon-(192|512)\.png$/.test(file))
        failures.push({ file, rule: 'unexpected-binary' });
      continue;
    }
    scan(data.toString('utf8'), file);
  }
  let excludedPreviewMetadata = null;
  const classifiedPlatformServiceFields = {
    committerEmailFields: 0,
    exactBotTrailerLines: 0,
    identityVerification: 'not_performed',
  };
  if (history) {
    const commits = git(['rev-list', '--all']).trim().split('\n').filter(Boolean);
    const seen = new Set();
    for (const commit of commits) {
      // GitHub's temporary PR merge is not authored project history. Its actor
      // identity is platform metadata. Validate the exact CI SHA, ref, parents and
      // generated subject before excluding only that metadata; scan every blob
      // and every parent commit normally. Real merge commits remain in scope.
      let preview = false;
      if (
        process.env.GITHUB_ACTIONS === 'true' &&
        process.env.GITHUB_EVENT_NAME === 'pull_request' &&
        /^refs\/pull\/[1-9]\d*\/merge$/.test(process.env.GITHUB_REF ?? '') &&
        commit === process.env.GITHUB_SHA &&
        commit === git(['rev-parse', 'HEAD']).trim()
      ) {
        const parents = git(['show', '-s', '--format=%P', commit]).trim().split(' ');
        const subject = git(['show', '-s', '--format=%s', commit]).trim();
        preview = parents.length === 2 && subject === `Merge ${parents[1]} into ${parents[0]}`;
      }
      if (preview) excludedPreviewMetadata = commit.slice(0, 12);
      else {
        const fields = git([
          'show',
          '-s',
          '--format=%an%x00%ae%x00%cn%x00%ce%x00%B%x00%P',
          commit,
        ]).split('\0');
        if (fields.length !== 6) throw new CoreGitError('CORE_GIT_HISTORY_METADATA_REJECTED');
        const [authorName, authorEmail, committerName, committerEmail, message, parentText] =
          fields;
        const metadata = [authorName, authorEmail, committerName, committerEmail, message].join(
          '\n',
        );
        const parents = parentText.trim().split(/\s+/).filter(Boolean);
        const subject = message.split('\n', 1)[0];
        // GitHub documents this shared service committer for web-created commits:
        // https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
        // This exact bot-shaped profile classifies only shared platform addresses.
        // It does not authenticate the actor or verify a signature; metadata can be forged.
        const platformBotProfile =
          authorName === 'dependabot[bot]' &&
          /^49699333\+dependabot\[bot\]@users\.noreply\.github\.com$/.test(authorEmail) &&
          committerName === 'GitHub' &&
          /^noreply@github\.com$/.test(committerEmail) &&
          parents.length === 1 &&
          /^build\(deps(?:-dev)?\): bump [^\r\n]+$/.test(subject);
        let privateEmailView = metadata;
        if (platformBotProfile) {
          const lines = message.split('\n');
          const platformTrailer = /^Signed-off-by: dependabot\[bot\] <support@github\.com>$/;
          const matching = lines.filter((line) => platformTrailer.test(line));
          let emailMessage = message;
          // Exactly one complete line is eligible. Prefixes, suffixes, other trailers,
          // author metadata and every other message byte remain in the email scan.
          if (matching.length === 1) {
            emailMessage = lines
              .map((line) =>
                platformTrailer.test(line) ? 'Signed-off-by: [platform-bot-service]' : line,
              )
              .join('\n');
            classifiedPlatformServiceFields.exactBotTrailerLines++;
          }
          privateEmailView = [
            authorName,
            authorEmail,
            committerName,
            '[platform-committer-service]',
            emailMessage,
          ].join('\n');
          classifiedPlatformServiceFields.committerEmailFields++;
        }
        // Only the private-email rule uses the field-specific view. Deny terms,
        // credentials, identifiers and paths still inspect original metadata.
        scan(metadata, `commit:${commit.slice(0, 12)}`, privateEmailView);
      }
      const entries = git(['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean);
      for (const entry of entries) {
        const [header, path] = entry.split('\t'),
          hash = header.split(' ')[2];
        if (!hash || seen.has(hash)) continue;
        seen.add(hash);
        const data = git(['cat-file', 'blob', hash], { binary: true, maxBuffer: 8 * 1024 * 1024 });
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
        history,
        embedded: core.embedded,
        excludedPreviewMetadata,
        classifiedPlatformServiceFields,
        scope: 'heuristic scan; manual review still required',
      }) + '\n',
    );
}

try {
  main();
} catch (error) {
  process.stderr.write(JSON.stringify(coreGitFailure(error, 'PRIVACY_CHECK_REJECTED')) + '\n');
  process.exitCode = 1;
}
