import { Logger } from '@nestjs/common';

import {
  runWithCorrelationId,
  runWithTenantContext,
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../common/context/correlation-id-context.js';
import * as validateEnv from '../config/validate-env.js';

import { applyTenantGucs, setGucQueryRunner } from './apply-tenant-gucs.js';

/**
 * The acceptance check for the tenant-organisation fix.
 *
 * `resolveTenantGucValues` used to resolve `app.current_org` as
 *
 *   store ?? synchronousTenantFallback ?? lastKnownOrganisationIdForGuc ?? ''
 *
 * and both fallbacks were process-global: every `setCurrentOrganisationId`
 * wrote the first, every JwtAuthGuard / ActiveOrganisationGuard wrote the
 * second. So whenever the store had no organisation — or there was no store,
 * which was every worker job and every cron — the value sent was whichever
 * other request or job wrote last. Every policy comparing against
 * `app_current_org()` then evaluated correctly, against the wrong tenant.
 *
 * Both fallbacks are deleted. The resolver reads the store and nothing else;
 * a store without an organisation sends '', which matches no policy, and a
 * job gets a store of its own from `runWithTenantContext`. Each test below is
 * one real path, reproduced at the value each statement actually sends. The
 * first four failed before the fix; the fifth is the no-organisation job.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_B = '33333333-3333-4333-8333-333333333333';

function envWithTenantContext() {
  /* eslint-disable @typescript-eslint/naming-convention -- keys mirror process.env */
  return {
    ...validateEnv.parseEnv({
      NODE_ENV: 'development',
      JWT_SECRET: 'change-me-in-production',
    }),
    TENANT_DB_CONTEXT_ENABLED: true,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

const orgSent = (runner: jest.Mock): string[] =>
  (runner.mock.calls as [string, string[]][]).map(([, params]) => params[0]);

const gate = (): { wait: Promise<void>; open: () => void } => {
  let open = (): void => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
};

describe('app.current_org when the store does not carry one', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(envWithTenantContext());
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * WORKER. The worker runs eleven queue processors in one process; a PDF job
   * for one organisation and an EPA-pack job for another interleave at every
   * await. Each processor's `process()` now enters the job's own store.
   */
  it('sends a worker job its own organisation while another job runs', async () => {
    const pdfJobForA = jest.fn().mockResolvedValue(undefined);
    const epaJobStarted = gate();

    await Promise.all([
      runWithTenantContext(
        { label: 'pdf:generate#1', organisationId: ORG_A },
        async () => {
          await epaJobStarted.wait; // any await inside the job
          setGucQueryRunner(pdfJobForA);
          await applyTenantGucs({} as never);
        },
      ),
      runWithTenantContext(
        { label: 'epa-pack:build#2', organisationId: ORG_B },
        async () => {
          epaJobStarted.open();
          await Promise.resolve();
        },
      ),
    ]);

    expect(orgSent(pdfJobForA)).toEqual([ORG_A]);
  });

  /**
   * API. A request whose store never receives an organisation — a token with
   * no `orgId` (a user with no membership yet) — while another tenant's
   * request is past its guards. JwtStrategy.validate reads the user before
   * any organisation exists for this request; routes behind JwtAuthGuard
   * alone never set one at all.
   */
  it('sends nothing for a request with no organisation while another tenant is in flight', async () => {
    const requestB = jest.fn().mockResolvedValue(undefined);
    const bQueried = gate();

    await Promise.all([
      runWithCorrelationId('request-a', async () => {
        setCurrentOrganisationId(ORG_A); // JwtStrategy / guards for tenant A
        await bQueried.wait;
      }),
      runWithCorrelationId('request-b', async () => {
        setCurrentUserId(USER_B); // JwtStrategy.validate, token without orgId
        setGucQueryRunner(requestB);
        await applyTenantGucs({} as never); // usersService.findById
        bQueried.open();
      }),
    ]);

    expect(orgSent(requestB)).toEqual(['']);
  });

  /**
   * API, the request after. Request A's guard set its organisation and A has
   * finished. Request B starts afterwards with none. The second fallback used
   * to survive A's finish — `lastKnownOrganisationIdForGuc` was cleared only
   * on response close, which could land after B had started — so B was handed
   * the last organisation any guard saw.
   */
  it('does not hand a new request the last organisation any guard saw', async () => {
    const requestB = jest.fn().mockResolvedValue(undefined);

    await runWithCorrelationId('request-a', async () => {
      setCurrentOrganisationId(ORG_A); // active-organisation.guard.ts, request A
      await Promise.resolve();
    });

    await runWithCorrelationId('request-b', async () => {
      setCurrentUserId(USER_B);
      setGucQueryRunner(requestB);
      await applyTenantGucs({} as never);
    });

    expect(orgSent(requestB)).toEqual(['']);
  });

  /** The control: a store that carries its organisation is never overridden. */
  it('keeps a request that has its organisation on it, whatever others write', async () => {
    const requestB = jest.fn().mockResolvedValue(undefined);
    const aWrote = gate();

    await Promise.all([
      runWithCorrelationId('request-a', async () => {
        setCurrentOrganisationId(ORG_A);
        aWrote.open();
        await Promise.resolve();
      }),
      runWithCorrelationId('request-b', async () => {
        setCurrentOrganisationId(ORG_B);
        await aWrote.wait;
        setGucQueryRunner(requestB);
        await applyTenantGucs({} as never);
      }),
    ]);

    expect(orgSent(requestB)).toEqual([ORG_B]);
  });

  /**
   * WORKER, a job with no organisation. The system ping, an email send, a
   * cron before it enters a per-organisation store: each gets a store with
   * no organisation on it and sends '' — not the organisation of whichever
   * job ran before it on the same worker. The warning names the job, so a job
   * that genuinely needs one is found in the log rather than by a tenant.
   */
  it('sends nothing for a job with no organisation, not the previous job’s', async () => {
    const pingJob = jest.fn().mockResolvedValue(undefined);

    await runWithTenantContext(
      { label: 'pdf:generate#4', organisationId: ORG_A },
      async () => {
        await Promise.resolve();
      },
    );

    await runWithTenantContext({ label: 'system:ping#5' }, async () => {
      setGucQueryRunner(pingJob);
      await applyTenantGucs({} as never);
    });

    expect(orgSent(pingJob)).toEqual(['']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'No organisation in the tenant context for system:ping#5',
      ),
    );
  });
});
