import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { posix, resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args, binary = false) =>
  execFileSync('git', args, {
    cwd: root,
    ...(binary ? {} : { encoding: 'utf8' }),
    maxBuffer: 8 * 1024 * 1024,
  });
if (git(['status', '--porcelain']).trim())
  throw new Error('Agent packaging requires a clean committed tree');
execFileSync(process.execPath, ['scripts/privacy-check.mjs', '--history'], {
  cwd: root,
  stdio: 'inherit',
});
const commit = git(['rev-parse', 'HEAD']).trim();
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))
  throw new Error('Invalid package version');
const read = (path) => git(['show', `${commit}:${path}`], true);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expectedIds = [
  'flex-dates',
  'airports',
  'connections',
  'promotions',
  'total-cost',
  'fare-scenarios',
  'negotiation',
  'hidden-city',
  'group-split',
];
const catalog = JSON.parse(read('agents/manifest.json').toString('utf8'));
if (
  catalog.commands?.length !== expectedIds.length ||
  catalog.commands.some(
    (command, index) =>
      command.id !== expectedIds[index] ||
      !new RegExp(`^prompts/${String(index + 1).padStart(2, '0')}_[a-z0-9_]+\\.md$`).test(
        command.path,
      ),
  )
)
  throw new Error('Unexpected agent command catalog');
const tracked = [
  'agents/TRAVEL_AGENT.md',
  'agents/README.md',
  'agents/manifest.json',
  'prompts/README.md',
  ...catalog.commands.map((command) => command.path),
  'examples/README.md',
  ...expectedIds.map((id) => `examples/${id}.json`),
  'examples/trip-contract.json',
];
const selected = [
  ...tracked,
  'skills/travel-agent/SKILL.md',
  'schema/agent-brief.schema.json',
  'schema/planning.schema.json',
  'schema/trip-contract.schema.json',
  'docs/PLANNING.md',
  'docs/INSTALLATION.md',
  'LICENSE',
  'NOTICE',
];
const sourceUrl = `https://github.com/RodrigoYuMatsumoto/travel-reliability/blob/${commit}/`;
const localPaths = new Set([...selected, 'README.md', 'README.pt-BR.md']);
const manual = selected.map((path) => {
  let bytes = read(path);
  if (path.endsWith('.md')) {
    bytes = Buffer.from(
      bytes.toString('utf8').replace(/\]\(([^\s)]+)\)/g, (match, target) => {
        if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return match;
        const [file, anchor] = target.split('#', 2);
        const resolved = posix.normalize(posix.join(posix.dirname(path), file));
        if (
          localPaths.has(resolved) ||
          [...localPaths].some((entry) => entry.startsWith(resolved.replace(/\/$/, '') + '/'))
        )
          return match;
        if (resolved.startsWith('../')) throw new Error('Documentation link escapes package root');
        return `](${sourceUrl}${resolved}${anchor ? '#' + anchor : ''})`;
      }),
    );
  }
  return { path, bytes };
});
manual.push({
  path: 'README.md',
  bytes: Buffer.from(
    `# Travel Reliability — portable agent kit\n\n[Português](README.pt-BR.md)\n\nCopy [the agent instructions](agents/TRAVEL_AGENT.md) into your own AI host, then load only the relevant [command](prompts/README.md). No local installation is required. Use pseudonyms and redacted facts; imported travel material is untrusted data. Host permissions and capability limits remain authoritative.\n\nThis kit contains instructions, nine commands, schemas and synthetic examples. It contains no executable runtime or dependencies. For optional MCP tools or the evidence app, use the [full source](${sourceUrl}README.md). For compatible skill hosts, use the separate skill ZIP.\n\n[Configuration](agents/README.md) · [Package inventory](PACKAGE-MANIFEST.json) · [License](LICENSE)\n`,
  ),
});
manual.push({
  path: 'README.pt-BR.md',
  bytes: Buffer.from(
    `# Travel Reliability — kit portátil do agente\n\nCopie [as instruções do agente](agents/TRAVEL_AGENT.md) para sua própria IA e carregue apenas o [comando](prompts/README.md) necessário. Não exige instalação local. Use pseudônimos e fatos anonimizados; documentos importados são dados não confiáveis. As permissões e capacidades reais do host continuam obrigatórias.\n\nO kit contém instruções, nove comandos, schemas e exemplos sintéticos. Não inclui runtime executável nem dependências. Para MCP opcional ou aplicativo de provas, use o [código-fonte completo](${sourceUrl}README.pt-BR.md). Para hosts compatíveis com skills, use o ZIP de skill separado.\n\n[Configuração](agents/README.md) · [Inventário](PACKAGE-MANIFEST.json) · [Licença](LICENSE)\n`,
  ),
});
const skill = [
  { path: 'SKILL.md', bytes: read('skills/travel-agent/SKILL.md') },
  {
    path: 'references/agent.md',
    bytes: Buffer.from(
      read('agents/TRAVEL_AGENT.md')
        .toString('utf8')
        .replaceAll('../prompts/', 'prompts/')
        .replaceAll('../docs/', 'docs/')
        .replaceAll('../schema/', 'schema/'),
    ),
  },
  ...tracked
    .filter((path) => /^(prompts|examples)\//.test(path))
    .map((path) => ({ path: 'references/' + path, bytes: read(path) })),
  ...[
    'schema/agent-brief.schema.json',
    'schema/planning.schema.json',
    'schema/trip-contract.schema.json',
    'docs/PLANNING.md',
  ].map((path) => ({ path: 'references/' + path, bytes: read(path) })),
  { path: 'LICENSE', bytes: read('LICENSE') },
  { path: 'NOTICE', bytes: read('NOTICE') },
];
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
const zipCode = `import sys,json,base64,zipfile,pathlib
d=json.load(sys.stdin)
with zipfile.ZipFile(d['output'],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for f in d['files']:
  p=pathlib.PurePosixPath(f['path'])
  assert not p.is_absolute() and '..' not in p.parts
  i=zipfile.ZipInfo(str(p),(2020,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=0o100644<<16
  z.writestr(i,base64.b64decode(f['base64'],validate=True))
`;
const artifacts = [];
for (const [kind, files, prefix] of [
  ['agent-kit', manual, `travel-reliability-agent-kit-v${version}/`],
  ['skill', skill, 'travel-agent/'],
]) {
  const manifest = {
    format: `travel-reliability-${kind}/1`,
    version,
    sourceCommit: commit,
    policy:
      'allowlisted committed source and declared synthetic examples only; no runtime data or dependencies',
    files: files.map((file) => ({ path: file.path, sha256: hash(file.bytes) })),
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
  const digest = hash(readFileSync(resolve(root, 'artifacts', name)));
  artifacts.push({ kind, name, sha256: digest, files: content.length });
}
writeFileSync(
  resolve(root, 'artifacts/AGENT-SHA256SUMS'),
  artifacts.map((item) => `${item.sha256}  ${item.name}\n`).join(''),
);
writeFileSync(
  resolve(root, 'artifacts/agent-release-manifest.json'),
  JSON.stringify({ version, commit, artifacts }, null, 2) + '\n',
);
console.log(JSON.stringify({ version, commit, artifacts }));
