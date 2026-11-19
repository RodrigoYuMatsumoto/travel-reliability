import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { decryptBundle } from '../api/src/exports.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { dossier: { type: 'string' }, originals: { type: 'string' } },
});
const passphrase = process.env.TRAVEL_BUNDLE_PASSPHRASE;
const [file] = positionals;
if (positionals.length !== 1 || !file || !passphrase)
  throw new Error(
    'Usage: npm run verify:bundle -- bundle.trb [--dossier output.json] [--originals new-directory]',
  );

const bundle = decryptBundle(await readFile(file), passphrase);
const originals = values.originals;
if (originals) {
  const ids = bundle.files.map(({ id }) => id.toLowerCase());
  if (
    new Set(ids).size !== ids.length ||
    bundle.files.some(({ id }) => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))
  )
    throw new Error('BUNDLE_EXPORT_IDENTIFIER_INVALID');
  // The destination must be new. Opaque IDs cannot direct writes elsewhere.
  await mkdir(originals, { mode: 0o700 });
  for (const { id, base64 } of bundle.files)
    await writeFile(join(originals, 'evidence-' + id + '.bin'), Buffer.from(base64, 'base64'), {
      flag: 'wx',
      mode: 0o600,
    });
}
if (values.dossier)
  await writeFile(values.dossier, JSON.stringify(bundle.dossier, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
console.log(
  JSON.stringify({
    verified: true,
    fileCount: bundle.files.length,
    format: bundle.format,
    originalsExported: originals ? bundle.files.length : 0,
  }),
);
