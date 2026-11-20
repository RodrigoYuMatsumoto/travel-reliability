import { readFile, stat } from 'node:fs/promises';
import { fetchObservation, normalizeObservation } from '../agent/trip-observations.js';

async function readJson(file: string) {
  if ((await stat(file)).size > 262144) throw new Error('OBSERVATION_FILE_LIMIT');
  return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

const [mode, requestFile, responseFile, observedAt, ...extra] = process.argv.slice(2);
try {
  if (!requestFile || extra.length) throw new Error('OBSERVATION_USAGE');
  const request = await readJson(requestFile);
  const result =
    mode === 'fetch' && !responseFile && !observedAt
      ? await fetchObservation(request)
      : mode === 'import' && responseFile && observedAt
        ? normalizeObservation(request, await readJson(responseFile), observedAt)
        : null;
  if (!result) throw new Error('OBSERVATION_USAGE');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : 'OBSERVATION_REJECTED',
  );
  process.exitCode = 1;
}
