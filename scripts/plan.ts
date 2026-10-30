import { readFile } from 'node:fs/promises';
import { plan } from '../api/src/planning.js';
const [tool, filename] = process.argv.slice(2);
if (!tool || !filename) {
  console.error('Usage: npm run plan -- <tool-id> <input.json>');
  process.exitCode = 2;
} else {
  try {
    const result = plan(tool, JSON.parse(await readFile(filename, 'utf8')));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'PLANNING_FAILED');
    process.exitCode = 1;
  }
}
