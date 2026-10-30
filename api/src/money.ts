import { requireCondition } from './errors.js';
export function addMinor(a: number, b: number): number {
  requireCondition(Number.isSafeInteger(a) && Number.isSafeInteger(b), 'INVALID_MONEY', 422);
  const result = Number(BigInt(a) + BigInt(b));
  requireCondition(Number.isSafeInteger(result), 'MONEY_OVERFLOW', 422);
  return result;
}
