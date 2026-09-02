import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Thrown by `DasManualClient` when the platform asks for DAS data that nobody
 * has entered yet.
 *
 * ── WHY THIS THROWS RATHER THAN RETURNING AN EMPTY SHAPE ────────────────────
 *
 * Returning `{ balance: null }` or `[]` would be indistinguishable from "DAS
 * says you have nothing", and a levy balance is a number people commit money
 * against. Absent data has to stay absent and say so.
 *
 * Throwing also lands the caller in the path already written for a DAS outage:
 * `das-levy-sync.service.ts` catches, sets `lastSyncStatus = FAILED`, records
 * `lastErrorMessage`, saves, and re-raises. The message below is what an
 * administrator then reads on the sync-status card, so it names the fix rather
 * than the fault.
 *
 * `ServiceUnavailableException` (503) rather than 404: the resource is not
 * missing, the integration is not configured. That is a temporary state an
 * administrator resolves, which is what 503 means.
 */
export class DasManualDataMissingException extends ServiceUnavailableException {
  constructor(
    /** What was asked for, in the administrator's words — "levy balance". */
    public readonly dataset: string,
    /** How to supply it. Shown verbatim, so keep it actionable. */
    hint = 'Enter it under Settings → Levy data.',
    /** Optional scope, e.g. a UKPRN, to distinguish which record is missing. */
    public readonly scope?: string,
  ) {
    super(
      `DAS is running in manual mode and no ${dataset} has been entered` +
        (scope ? ` for ${scope}` : '') +
        `. ${hint}`,
    );
  }
}
