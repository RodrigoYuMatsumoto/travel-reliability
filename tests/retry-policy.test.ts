import { describe, it, expect } from 'vitest';
import { boundedRead, ReadFailure, type ReadPolicy } from '../agent/retry-policy.js';
const policy: ReadPolicy = {
  operation: 'provider-status',
  method: 'GET',
  idempotent: true,
  maxAttempts: 3,
  deadlineMs: 10000,
  baseDelayMs: 100,
};
describe('explicit opt-in read repetition', () => {
  it('does not repeat a failed read by default', async () => {
    let calls = 0;
    await expect(
      boundedRead(async () => {
        calls++;
        throw new ReadFailure('TRANSIENT_UNAVAILABLE');
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it('caps attempts and uses exponential backoff without reflecting raw exceptions', async () => {
    let calls = 0,
      time = 0;
    const delays: number[] = [];
    const logs: unknown[] = [];
    const value = await boundedRead(
      async () => {
        if (++calls < 3) throw new ReadFailure('TRANSIENT_UNAVAILABLE');
        return 7;
      },
      policy,
      (row) => logs.push(row),
      {
        now: () => time,
        sleep: async (ms) => {
          delays.push(ms);
          time += ms;
        },
      },
    );
    expect(value).toBe(7);
    expect(calls).toBe(3);
    expect(delays).toEqual([100, 200]);
    expect(logs).toHaveLength(3);
    calls = 0;
    await expect(
      boundedRead(async () => {
        calls++;
        throw new Error('synthetic private message');
      }, policy),
    ).rejects.toThrow('PERMANENT_REJECTION');
    expect(calls).toBe(1);
  });
  it('rejects mutation methods and exhausted deadlines', async () => {
    await expect(
      boundedRead(async () => 1, { ...policy, method: 'POST' } as unknown as ReadPolicy),
    ).rejects.toThrow('READ_POLICY_REJECTED');
    let calls = 0;
    await expect(
      boundedRead(
        async () => {
          calls++;
          throw new ReadFailure('RATE_LIMITED');
        },
        { ...policy, deadlineMs: 50 },
        () => {},
        { now: () => 0, sleep: async () => {} },
      ),
    ).rejects.toThrow('DEADLINE_EXCEEDED');
    expect(calls).toBe(1);
  });
});
