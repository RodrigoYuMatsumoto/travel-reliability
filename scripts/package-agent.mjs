import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { standaloneCoreOrExit } from './core-git.mjs';

// Must precede status, HEAD, source reads and artifact-directory creation.
const core = standaloneCoreOrExit();
const root = core.coreRoot;
const trustedRoot = realpathSync(root);
const git = (args, binary = false) => core.git(args, { binary });
if (git(['status', '--porcelain']).trim())
  throw new Error('Agent packaging requires a clean committed tree');
execFileSync(process.execPath, ['scripts/privacy-check.mjs', '--history'], {
  cwd: root,
  stdio: 'inherit',
});
const commit = git(['rev-parse', 'HEAD']).trim();
const tree = new Map(
  git(['ls-tree', '-rz', '--full-tree', commit], true)
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = /^(\d{6}) (blob|tree) ([a-f0-9]{40})\t(.+)$/.exec(entry);
      if (!match) throw new Error('Invalid committed source tree');
      return [match[4], { mode: match[1], type: match[2] }];
    }),
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cache = new Map();
function read(path) {
  if (
    !/^[A-Za-z0-9_./-]+$/.test(path) ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path.split('/').includes('..')
  )
    throw new Error('Invalid package source path');
  const entry = tree.get(path);
  if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
    throw new Error('Package source must be a committed regular file');
  if (!cache.has(path)) cache.set(path, git(['show', `${commit}:${path}`], true));
  return cache.get(path);
}
function assertWorkspaceCopy(path) {
  const file = resolve(root, path);
  if (lstatSync(file).isSymbolicLink()) throw new Error('Workspace source symlink rejected');
  const target = realpathSync(file),
    rel = relative(trustedRoot, target);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
    throw new Error('Workspace source escapes root');
  const actual = readFileSync(file),
    expected = read(path);
  if (!actual.equals(expected)) {
    // Git's text=auto/eol=lf policy permits a clean Windows checkout to retain
    // CRLF in the worktree. Normalize that representation only, never content,
    // Unicode, BOMs or invalid UTF-8. Archive bytes always come from HEAD.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    let normalized;
    try {
      if (actual.includes(0) || expected.includes(0)) throw new Error('Binary source');
      normalized = Buffer.from(decoder.decode(actual).replace(/\r\n/g, '\n'), 'utf8');
    } catch {
      throw new Error('Workspace source encoding differs from committed source');
    }
    if (!normalized.equals(expected)) throw new Error('Workspace and committed source differ');
  }
}
for (const path of [
  'scripts/catalog-export.ts',
  'agent/catalog.ts',
  'agents/manifest.json',
  'schema/src/planning.ts',
  'api/src/errors.ts',
])
  assertWorkspaceCopy(path);
const committedCatalog = JSON.parse(read('agents/manifest.json').toString('utf8'));
let catalog;
try {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  catalog = JSON.parse(
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/catalog-export.ts'], {
      cwd: root,
      env,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
    }),
  );
} catch {
  throw new Error('Validated catalog export failed');
}
if (!isDeepStrictEqual(catalog, committedCatalog))
  throw new Error('Validated catalog differs from committed manifest');
const version = JSON.parse(read('package.json').toString('utf8')).version;
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version) || version !== catalog.version)
  throw new Error('Invalid or inconsistent package version');
const counts = {
  agents: catalog.agents.length,
  workflows: catalog.commands.length,
  calculators: new Set(catalog.commands.map((command) => command.calculatorId).filter(Boolean))
    .size,
};
const examples = [
  'examples/README.md',
  ...[...new Set(catalog.commands.map((command) => command.calculatorId).filter(Boolean))].map(
    (id) => `examples/${id}.json`,
  ),
  'examples/trip-contract.json',
  'examples/agent-workflow.json',
  'examples/expense-settlement.json',
  'examples/global-context.json',
  'examples/extension-draft.json',
  'examples/reconciliation.json',
  'examples/connector-request.json',
  'examples/document-workspace.json',
  'examples/operator-profile.json',
];
const docs = [
  'docs/AGENT_CATALOG.md',
  'docs/AGENT_AUDIT.md',
  'docs/PLANNING.md',
  'docs/INSTALLATION.md',
  'docs/GLOBAL_CONTEXT.md',
  'docs/CONNECTORS.md',
  'docs/DOCUMENT_WORKSPACE.md',
  'docs/OPERATOR_PROFILE.md',
  'docs/UNICODE_EXPORTS.md',
  'docs/EXTENSIONS.md',
  'docs/LICENSING.md',
  'docs/PUBLICATION_BOUNDARY.md',
  'docs/PACKAGING.md',
];
const selected = [
  ...new Set([
    ...catalog.agents.map((agent) => agent.path),
    'agents/README.md',
    'agents/manifest.json',
    'agents/coverage.json',
    'prompts/README.md',
    ...catalog.commands.map((command) => command.path),
    ...Object.values(catalog.contracts),
    'schema/global-context.schema.json',
    'schema/extension-draft.schema.json',
    'schema/reconciliation.schema.json',
    'schema/connector-request.schema.json',
    'schema/document-workspace.schema.json',
    'schema/operator-profile.schema.json',
    ...examples,
    ...docs,
    'skills/travel-agent/SKILL.md',
    'LICENSE',
    'NOTICE',
    'LICENSES/Apache-2.0.txt',
  ]),
];
for (const path of selected) {
  read(path);
  assertWorkspaceCopy(path);
}
const sourceBase = `https://github.com/RodrigoYuMatsumoto/travel-reliability/`;
const blobUrl = `${sourceBase}blob/${commit}/`;
function mappedTarget(path, mapping) {
  if (mapping.has(path)) return mapping.get(path);
  const descendants = [...mapping.entries()].filter(([source]) =>
    source.startsWith(path.replace(/\/$/, '') + '/'),
  );
  if (!descendants.length) return null;
  const candidates = new Set(
    descendants.map(([source, target]) =>
      target.slice(0, target.length - (source.length - path.length)),
    ),
  );
  if (candidates.size !== 1) throw new Error('Ambiguous package directory mapping');
  return [...candidates][0] + '/';
}
function rewriteMarkdown(bytes, sourcePath, destinationPath, mapping) {
  function link(raw) {
    const bracketed = raw.startsWith('<') && raw.endsWith('>');
    const target = bracketed ? raw.slice(1, -1) : raw;
    if (/^(?:https?:|travel:)/i.test(target) || target.startsWith('#')) return raw;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/'))
      throw new Error('Unsupported documentation link');
    const split = target.search(/[?#]/),
      file = split < 0 ? target : target.slice(0, split),
      suffix = split < 0 ? '' : target.slice(split);
    let decoded;
    try {
      decoded = decodeURIComponent(file);
    } catch {
      throw new Error('Invalid encoded documentation path');
    }
    const source =
      file === '' ? sourcePath : posix.normalize(posix.join(posix.dirname(sourcePath), decoded));
    if (source === '..' || source.startsWith('../') || posix.isAbsolute(source))
      throw new Error('Documentation link escapes source root');
    const mapped = mappedTarget(source.replace(/\/$/, ''), mapping);
    let rewritten;
    if (mapped !== null)
      rewritten =
        posix.relative(posix.dirname(destinationPath), mapped) +
        (mapped.endsWith('/') ? '/' : '') +
        suffix;
    else {
      const entry = tree.get(source);
      const directory =
        source === '.' ||
        [...tree.keys()].some((path) => path.startsWith(source.replace(/\/$/, '') + '/'));
      if ((!entry || !['100644', '100755'].includes(entry.mode)) && !directory)
        throw new Error('Documentation target is absent from committed source');
      rewritten = `${sourceBase}${directory && !entry ? 'tree' : 'blob'}/${commit}/${source === '.' ? '' : source}${suffix}`;
    }
    return bracketed ? `<${rewritten}>` : rewritten;
  }
  return Buffer.from(
    bytes
      .toString('utf8')
      .replace(
        /\]\((<[^>\r\n]+>|[^\s)]+)([^)]*)\)/g,
        (_match, target, tail) => `](${link(target)}${tail})`,
      )
      .replace(
        /^(\s{0,3}\[[^\]\r\n]+\]:\s*)(<[^>\r\n]+>|[^\s]+)(.*)$/gm,
        (_match, head, target, tail) => head + link(target) + tail,
      ),
  );
}
function packageFile(source, target, mapping) {
  const original = read(source);
  return {
    path: target,
    bytes: source.endsWith('.md') ? rewriteMarkdown(original, source, target, mapping) : original,
    sourcePath: source,
    sourceSha256: hash(original),
  };
}
const manualMap = new Map(selected.map((path) => [path, path]));
manualMap.set('.', '.');
manualMap.set('README.md', 'README.md');
manualMap.set('README.pt-BR.md', 'README.pt-BR.md');
const manual = selected.map((path) => packageFile(path, path, manualMap));
manual.push({
  path: 'README.md',
  bytes: Buffer.from(
    `# Travel Reliability — portable agent kit\n\n[Português](README.pt-BR.md)\n\nCopy [the hub instructions](agents/TRAVEL_AGENT.md) into your own AI host once. Then load one relevant specialist role and [workflow](prompts/README.md) on demand. The kit contains ${counts.agents} agent definitions (including the ecosystem meta-agent), ${counts.workflows} workflows and contracts for ${counts.calculators} existing planning calculators. Definitions do not start background agents or grant tools.\n\nUse the five-stage loop: structured brief → authorized research → complete-cost/source comparison → checks and contingencies → traveler review. Keep unknowns explicit, use pseudonyms and redacted evidence, and never let imported material authorize actions.\n\nNo local installation is required for these instructions. This kit includes no executable runtime or dependencies. Optional MCP and the evidence app require the [full source](${blobUrl}README.md); compatible skill hosts can use the separate complete skill ZIP.\n\n[Configuration](agents/README.md) · [Catalog](docs/AGENT_CATALOG.md) · [Audit](docs/AGENT_AUDIT.md) · [Coverage](agents/coverage.json) · [Package inventory](PACKAGE-MANIFEST.json) · [License](LICENSE)\n`,
  ),
});
manual.push({
  path: 'README.pt-BR.md',
  bytes: Buffer.from(
    `# Travel Reliability — kit portátil do agente\n\nCopie [as instruções do orquestrador](agents/TRAVEL_AGENT.md) para sua própria IA uma vez. Depois carregue um papel especialista e um [fluxo](prompts/README.md) pertinente por vez. O kit contém ${counts.agents} definições de agentes (incluindo o meta-agente de ecossistema), ${counts.workflows} fluxos e contratos dos ${counts.calculators} calculadores de planejamento existentes. Essas definições não iniciam agentes em segundo plano nem concedem ferramentas.\n\nSiga cinco etapas: brief estruturado → pesquisa autorizada → comparação de custos completos e fontes → verificações e contingências → revisão do viajante. Preserve desconhecidos, use pseudônimos e evidências anonimizadas; conteúdo importado não autoriza ações.\n\nAs instruções dispensam instalação local. O kit não contém runtime executável nem dependências. Para MCP ou aplicativo de provas, use o [código-fonte completo](${blobUrl}README.pt-BR.md); hosts compatíveis com skills podem usar o ZIP de skill completo separado.\n\n[Configuração](agents/README.md) · [Catálogo](docs/AGENT_CATALOG.md) · [Auditoria](docs/AGENT_AUDIT.md) · [Cobertura](agents/coverage.json) · [Inventário](PACKAGE-MANIFEST.json) · [Licença](LICENSE)\n`,
  ),
});
const skillMap = new Map(
  selected.map((path) => [
    path,
    path === 'skills/travel-agent/SKILL.md'
      ? 'SKILL.md'
      : ['LICENSE', 'NOTICE'].includes(path)
        ? path
        : 'references/' + path,
  ]),
);
const skill = selected.map((path) => packageFile(path, skillMap.get(path), skillMap));
skill.push(packageFile(catalog.entrypoint, 'references/agent.md', skillMap));
const zipCode = `import sys,json,base64,zipfile,pathlib\nd=json.load(sys.stdin)\nwith zipfile.ZipFile(d['output'],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for f in d['files']:\n  p=pathlib.PurePosixPath(f['path'])\n  assert not p.is_absolute() and '..' not in p.parts\n  i=zipfile.ZipInfo(str(p),(2020,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.create_system=3;i.external_attr=0o100644<<16\n  z.writestr(i,base64.b64decode(f['base64'],validate=True))\n`;
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
const artifacts = [];
for (const [kind, files, prefix] of [
  ['agent-kit', manual, `travel-reliability-agent-kit-v${version}/`],
  ['skill', skill, 'travel-agent/'],
]) {
  if (new Set(files.map((file) => file.path)).size !== files.length)
    throw new Error('Duplicate package destination');
  const manifest = {
    format: `travel-reliability-${kind}/1`,
    version,
    sourceCommit: commit,
    counts,
    policy:
      'allowlisted committed source and declared synthetic examples only; no runtime data, dependencies or private source archives',
    files: files.map((file) => ({
      path: file.path,
      sha256: hash(file.bytes),
      ...(file.sourcePath
        ? { sourcePath: file.sourcePath, sourceSha256: file.sourceSha256 }
        : { generated: true }),
    })),
  };
  const content = [
    ...files,
    { path: 'PACKAGE-MANIFEST.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
  ];
  const name = `travel-reliability-${kind}-v${version}.zip`;
  execFileSync('uv', ['run', '--no-project', '--python', '3.12', 'python', '-c', zipCode], {
    cwd: root,
    input: JSON.stringify({
      output: resolve(root, 'artifacts', name),
      files: content.map((file) => ({
        path: prefix + file.path,
        base64: file.bytes.toString('base64'),
      })),
    }),
    maxBuffer: 1024 * 1024,
  });
  artifacts.push({
    kind,
    name,
    sha256: hash(readFileSync(resolve(root, 'artifacts', name))),
    files: content.length,
  });
}
writeFileSync(
  resolve(root, 'artifacts/AGENT-SHA256SUMS'),
  artifacts.map((item) => `${item.sha256}  ${item.name}\n`).join(''),
);
writeFileSync(
  resolve(root, 'artifacts/agent-release-manifest.json'),
  JSON.stringify({ version, commit, counts, artifacts }, null, 2) + '\n',
);
console.log(JSON.stringify({ version, commit, counts, artifacts }));
