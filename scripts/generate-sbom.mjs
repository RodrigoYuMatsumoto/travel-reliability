import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSbom } from './sbom-project.mjs';

if (!process.env.npm_execpath) throw new Error('Run through npm run sbom');
const root = fileURLToPath(new URL('../', import.meta.url));
const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const raw = JSON.parse(
  execFileSync(process.execPath, [process.env.npm_execpath, 'sbom', '--sbom-format', 'cyclonedx'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    shell: false,
  }),
);
let supplemental = null;
if (
  existsSync(join(root, 'ingest/uv.lock')) ||
  existsSync(join(root, 'deploy/renderer/provenance.json'))
) {
  const helper = join(root, 'scripts/sbom-python.py');
  const interpreter = join(
    root,
    'ingest/.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      [
        'PATH',
        'SYSTEMROOT',
        'WINDIR',
        'TEMP',
        'TMP',
        'COMSPEC',
        'PATHEXT',
        'LOCALAPPDATA',
        'UV_CACHE_DIR',
      ].includes(key.toUpperCase()),
    ),
  );
  environment.UV_PYTHON_DOWNLOADS = 'never';
  try {
    const command = existsSync(interpreter) ? interpreter : 'uv';
    const arguments_ = existsSync(interpreter)
      ? ['-I', '-B', helper]
      : [
          'run',
          '--offline',
          '--no-config',
          '--no-project',
          '--python',
          '3.12',
          '--no-python-downloads',
          'python',
          '-I',
          '-B',
          helper,
        ];
    supplemental = JSON.parse(
      execFileSync(command, arguments_, {
        cwd: root,
        env: environment,
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
        shell: false,
      }),
    );
  } catch {
    throw new Error('SBOM_PYTHON_INVENTORY_FAILED');
  }
}
const { body, omitted } = projectSbom(raw, packageMetadata, supplemental);
writeFileSync(new URL('../sbom.cdx.json', import.meta.url), JSON.stringify(body, null, 2) + '\n');
console.log(
  JSON.stringify({
    format: body.bomFormat,
    components: body.components?.length ?? 0,
    omittedOptionalIdentityFields: omitted,
  }),
);
