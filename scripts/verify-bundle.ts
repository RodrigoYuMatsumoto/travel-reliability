import { readFile, writeFile } from 'node:fs/promises';
import { decryptBundle } from '../api/src/exports.js';
const file = process.argv[2];
if (!file || !process.env.TRAVEL_BUNDLE_PASSPHRASE)
  throw new Error(
    'Usage: TRAVEL_BUNDLE_PASSPHRASE=... npm run verify:bundle -- bundle.trb [--dossier output.json]',
  );
const bundle = decryptBundle(await readFile(file), process.env.TRAVEL_BUNDLE_PASSPHRASE);
const exportIndex = process.argv.indexOf('--dossier');
if (exportIndex >= 0) {
  const destination = process.argv[exportIndex + 1];
  if (!destination) throw new Error('Destination required');
  await writeFile(destination, JSON.stringify(bundle.dossier, null, 2), { flag: 'wx' });
}
console.log(
  JSON.stringify({ verified: true, fileCount: bundle.files.length, format: bundle.format }),
);
