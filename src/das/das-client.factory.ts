import type { DasHttpClient } from './das-http.client.js';
import type { DasManualClient } from './das-manual.client.js';
import type { IDasClient } from './interfaces/das.client.interface.js';
import type { ConfigService } from '@nestjs/config';

/**
 * Whether the platform is running on manually-entered DAS figures.
 *
 * One predicate, used by both the provider factory below and the 409 guard on
 * `POST /das/sync`. They have to agree: a guard that thinks DAS is configured
 * while the factory has handed out the manual client would let a sync run and
 * stamp `lastSyncStatus = SUCCESS` over hand-typed data. Sharing the function
 * makes disagreement impossible rather than merely unlikely.
 *
 * `DAS_BASE_URL` is the signal because it is what `DasHttpClient.request`
 * requires — with no base URL it throws before making a call
 * (`das-http.client.ts:69`).
 *
 * Whitespace counts as absent. `DAS_BASE_URL=" "` is a half-finished env edit,
 * not a configured integration.
 */
export function isDasManualMode(config: ConfigService): boolean {
  return !config.get<string>('app.das.baseUrl', '')?.trim();
}

/**
 * Chooses the DAS client from configuration.
 *
 * A separate exported function rather than an inline `useFactory` body so the
 * decision can be tested without standing up a Nest module. It is one line,
 * and it determines whether a deployment talks to the ESFA or to figures
 * somebody typed — worth a test of its own.
 */
export function resolveDasClient(
  config: ConfigService,
  http: DasHttpClient,
  manual: DasManualClient,
): IDasClient {
  return isDasManualMode(config) ? manual : http;
}
