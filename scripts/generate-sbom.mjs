import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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
const { body, omitted } = projectSbom(raw, packageMetadata);
writeFileSync(new URL('../sbom.cdx.json', import.meta.url), JSON.stringify(body, null, 2) + '\n');
console.log(
  JSON.stringify({
    format: body.bomFormat,
    components: body.components?.length ?? 0,
    omittedOptionalIdentityFields: omitted,
  }),
);
