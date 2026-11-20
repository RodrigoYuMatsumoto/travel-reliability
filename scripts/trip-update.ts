import { readFile, stat } from 'node:fs/promises';
import { tripRevision } from '../agent/trip-update-store.js';
import { mergeTripFragments } from '../agent/trip-update.js';

async function readJson(file: string) {
  if ((await stat(file)).size > 2_000_000) throw new Error('UPDATE_INPUT_TOO_LARGE');
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

const [command, root, file, ...extra] = process.argv.slice(2);
try {
  const approval = command === 'apply' ? extra.shift() : undefined;
  if (
    !root ||
    (command === 'current' && file) ||
    (command === 'preview' && !file) ||
    (command === 'apply' && (!file || !approval)) ||
    extra.length > 24 ||
    extra.length % 2 !== 0 ||
    extra.some((arg, index) => index % 2 === 0 && arg !== '--fragment') ||
    !['current', 'preview', 'apply'].includes(command ?? '')
  )
    throw new Error('UPDATE_USAGE');
  const fragments = await Promise.all(extra.filter((_, index) => index % 2 === 1).map(readJson));
  const raw = file ? await readJson(file) : undefined;
  const input = fragments.length ? mergeTripFragments(raw, fragments) : raw;
  const result = await tripRevision(root, input, approval);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof Error && /^[A-Z_]+(?:[: ][a-z_]+)?$/.test(error.message)
      ? error.message
      : 'TRIP_UPDATE_REJECTED',
  );
  process.exitCode = 1;
}
