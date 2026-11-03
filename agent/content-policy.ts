import { requireCondition } from '../api/src/errors.js';
// Encoded policy vocabulary prevents it from being echoed by help, logs or fixtures.
const restricted = [
  [97, 108, 99, 111, 111, 108],
  [97, 108, 99, 111, 104, 111, 108],
  [99, 101, 114, 118, 101, 106, 97],
  [98, 101, 101, 114],
  [118, 105, 110, 104, 111],
  [119, 105, 110, 101],
  [119, 104, 105, 115, 107, 121],
  [119, 104, 105, 115, 107, 101, 121],
  [118, 111, 100, 107, 97],
  [99, 104, 97, 109, 112, 97, 103, 110, 101],
  [115, 97, 107, 101],
  [99, 97, 99, 104, 97, 99, 97],
  [103, 105, 110],
];
const blocked = new RegExp(
  '(?:^|[^a-z])(?:' +
    restricted.map((points) => String.fromCharCode(...points)).join('|') +
    ')(?:[^a-z]|$)',
  'i',
);
export function enforceContentPolicy(value: unknown): void {
  const normalized = JSON.stringify(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\\u([a-f0-9]{4})/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
  requireCondition(!blocked.test(normalized), 'RESTRICTED_CONTENT', 422);
}
