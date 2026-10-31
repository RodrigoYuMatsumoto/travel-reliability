import { it, expect } from 'vitest';
import { validateTrip } from '../api/src/validation.js';
import { input } from '../api/src/input-schemas.js';
import { plan } from '../api/src/planning.js';
import { demoTrip } from '../api/src/demo.js';
import { AppError } from '../api/src/errors.js';
import { buildApp } from '../api/src/app.js';
import { loadConfig } from '../api/src/config.js';

it('restricts fonts to the application origin instead of inheriting a wildcard HTTPS source', async () => {
  const { app } = await buildApp(loadConfig({ APP_MODE: 'demo' }));
  try {
    const response = await app.inject('/health');
    const directives = String(response.headers['content-security-policy'])
      .split(';')
      .map((part) => part.trim());
    expect(directives.find((part) => part.startsWith('font-src '))).toBe("font-src 'self'");
  } finally {
    await app.close();
  }
});

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
