import { resolveDasClient } from './das-client.factory.js';

import type { DasHttpClient } from './das-http.client.js';
import type { DasManualClient } from './das-manual.client.js';
import type { ConfigService } from '@nestjs/config';

/**
 * Which client a deployment gets.
 *
 * One line of logic, and it decides whether the platform talks to the ESFA or
 * to figures an administrator typed. Getting it backwards in either direction
 * is severe: an ESFA-configured deployment silently serving manual numbers, or
 * an unconfigured one throwing on every levy read because it thinks it has
 * credentials.
 */
describe('resolveDasClient', () => {
  const http = { kind: 'http' } as unknown as DasHttpClient;
  const manual = { kind: 'manual' } as unknown as DasManualClient;

  const configWith = (baseUrl: unknown): ConfigService =>
    ({
      get: (key: string, fallback?: unknown) => {
        expect(key).toBe('app.das.baseUrl');
        return baseUrl === undefined ? fallback : baseUrl;
      },
    }) as unknown as ConfigService;

  it('returns the HTTP client when a DAS base URL is configured', () => {
    expect(
      resolveDasClient(configWith('https://das.example.com'), http, manual),
    ).toBe(http);
  });

  it('returns the manual client when no base URL is set', () => {
    expect(resolveDasClient(configWith(''), http, manual)).toBe(manual);
  });

  it('returns the manual client when the key is absent entirely', () => {
    expect(resolveDasClient(configWith(undefined), http, manual)).toBe(manual);
  });

  it('treats a whitespace-only base URL as unconfigured', () => {
    // A half-finished env edit, not a configured integration. Choosing the
    // HTTP client here would make every DAS call fail at the base-URL guard
    // in das-http.client.ts:69, with nothing explaining why.
    expect(resolveDasClient(configWith('   '), http, manual)).toBe(manual);
  });

  it('treats a null base URL as unconfigured rather than throwing', () => {
    expect(resolveDasClient(configWith(null), http, manual)).toBe(manual);
  });
});
