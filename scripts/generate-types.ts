import { compileFromFile } from 'json-schema-to-typescript';
import { writeFile, readFile } from 'node:fs/promises';
const output = await compileFromFile('schema/trip-contract.schema.json', {
  bannerComment: '/* Generated from trip-contract.schema.json. Do not edit. */',
  additionalProperties: false,
});
const path = 'schema/src/trip-contract.ts';
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== output) throw new Error('Generated contract is stale');
} else await writeFile(path, output);
