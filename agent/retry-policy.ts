import { requireCondition } from '../api/src/errors.js';
export interface ReadPolicy {
  operation: 'public-weather' | 'public-municipality' | 'provider-status';
  method: 'GET' | 'HEAD';
  idempotent: true;
  maxAttempts: number;
  deadlineMs: number;
  baseDelayMs: number;
}
export class ReadFailure extends Error {
  constructor(
    public readonly code:
      'TRANSIENT_UNAVAILABLE' | 'RATE_LIMITED' | 'PERMANENT_REJECTION' | 'DEADLINE_EXCEEDED',
  ) {
    super(code);
  }
}
/** Operator callback only. No module loading, URL, credential, logging payload or auto opt-in. */
export async function boundedRead<T>(
  read: (signal: AbortSignal) => Promise<T>,
  policy?: ReadPolicy,
  log: (record: {
    event: string;
    operation: string;
    attempt: number;
    status: string;
  }) => void = () => {},
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
) {
  if (!policy) return read(new AbortController().signal);
  requireCondition(
    ['public-weather', 'public-municipality', 'provider-status'].includes(policy.operation) &&
      ['GET', 'HEAD'].includes(policy.method) &&
      policy.idempotent === true &&
      Number.isInteger(policy.maxAttempts) &&
      policy.maxAttempts >= 1 &&
      policy.maxAttempts <= 3 &&
      Number.isInteger(policy.deadlineMs) &&
      policy.deadlineMs >= 1 &&
      policy.deadlineMs <= 30000 &&
      Number.isInteger(policy.baseDelayMs) &&
      policy.baseDelayMs >= 0 &&
      policy.baseDelayMs <= 2000,
    'READ_POLICY_REJECTED',
    422,
  );
  const deadline = clock.now() + policy.deadlineMs;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const remaining = deadline - clock.now();
    if (remaining <= 0) throw new ReadFailure('DEADLINE_EXCEEDED');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ReadFailure('DEADLINE_EXCEEDED'));
      }, remaining);
    });
    try {
      const value = await Promise.race([read(controller.signal), timeout]);
      log({ event: 'read_attempt', operation: policy.operation, attempt, status: 'success' });
      return value;
    } catch (error) {
      const transient =
        error instanceof ReadFailure &&
        ['TRANSIENT_UNAVAILABLE', 'RATE_LIMITED'].includes(error.code);
      log({
        event: 'read_attempt',
        operation: policy.operation,
        attempt,
        status: transient ? 'transient_failure' : 'rejected',
      });
      if (!transient || attempt === policy.maxAttempts)
        throw new ReadFailure(error instanceof ReadFailure ? error.code : 'PERMANENT_REJECTION');
      const delay = policy.baseDelayMs * 2 ** (attempt - 1);
      if (clock.now() + delay >= deadline) throw new ReadFailure('DEADLINE_EXCEEDED');
      await clock.sleep(delay);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  throw new ReadFailure('PERMANENT_REJECTION');
}
