import type { DasHttpClient } from './das-http.client.js';
import type { DasManualClient } from './das-manual.client.js';
import type { IDasClient } from './interfaces/das.client.interface.js';
import type { ConfigService } from '@nestjs/config';

/**
 * Chooses the DAS client from configuration.
 *
 * A separate exported function rather than an inline `useFactory` body so the
 * decision can be tested without standing up a Nest module. The decision is
 * one line, and it is the line that determines whether a deployment talks to
 * the ESFA or to figures somebody typed — worth a test of its own.
 *
 * `DAS_BASE_URL` is the signal because it is what `DasHttpClient.request`
 * requires: with no base URL it throws before making a call
 * (`das-http.client.ts:69`). Selecting on the same value the HTTP client
 * needs means the two cannot disagree about whether DAS is configured.
 *
 * Whitespace counts as absent. A `DAS_BASE_URL=" "` in an env file is a
 * half-finished edit, not a configured integration.
 */
export function resolveDasClient(
  config: ConfigService,
  http: DasHttpClient,
  manual: DasManualClient,
): IDasClient {
  const baseUrl = config.get<string>('app.das.baseUrl', '');
  return baseUrl?.trim() ? http : manual;
}
