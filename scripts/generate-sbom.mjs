import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

if (!process.env.npm_execpath) throw new Error('Run through npm run sbom');
const body = JSON.parse(
  execFileSync(process.execPath, [process.env.npm_execpath, 'sbom', '--sbom-format', 'cyclonedx'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }),
);
let omitted = 0;
function project(value) {
  if (Array.isArray(value)) {
    value.forEach(project);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (['author', 'authors', 'email', 'phone'].includes(key.toLowerCase())) {
      delete value[key];
      omitted++;
    } else project(value[key]);
  }
}
project(body);
body.metadata ??= {};
body.metadata.properties ??= [];
body.metadata.properties.push({
  name: 'travel-reliability:privacy-projection',
  value:
    'Optional author, authors, email and phone fields omitted; package versions, hashes, licenses and references retained.',
});
writeFileSync('sbom.cdx.json', JSON.stringify(body, null, 2) + '\n');
console.log(
  JSON.stringify({
    format: body.bomFormat,
    components: body.components?.length ?? 0,
    omittedOptionalIdentityFields: omitted,
  }),
);
