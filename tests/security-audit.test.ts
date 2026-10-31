import { it, expect } from 'vitest';
import { validateTrip } from '../api/src/validation.js';
import { input } from '../api/src/input-schemas.js';
import { plan } from '../api/src/planning.js';
import { demoTrip } from '../api/src/demo.js';
import { AppError } from '../api/src/errors.js';

it('bounds validation diagnostics instead of amplifying thousands of invalid fields', () => {
  const extras = Object.fromEntries(
    Array.from({ length: 10000 }, (_, i) => [`synthetic-${i}`, 'untrusted']),
  );
  for (const attempt of [
    () => validateTrip({ ...demoTrip(), ...extras }),
    () => input('event', extras),
    () => plan('group-split', extras),
  ]) {
    let caught: unknown;
    try {
      attempt();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    const details = (caught as AppError).details;
    expect(JSON.stringify(details).length).toBeLessThan(4096);
    expect((details as unknown[]).length).toBeLessThanOrEqual(20);
  }
});
