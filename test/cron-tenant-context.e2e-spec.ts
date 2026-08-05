import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';

import {
  getRlsBootstrap,
  setCurrentOrganisationId,
  setCurrentUserId,
  setRlsBootstrap,
} from '../src/common/context/correlation-id-context.js';
import { CaseloadAlertService } from '../src/learners/caseload-alert.service.js';
import { OtjPaceService } from '../src/otj/otj-pace.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createProviderDirectoryContext } from './helpers/reporting-e2e.js';
import { createAppDbClient, setTenantGucs } from './helpers/rls-db.js';

import type { App } from 'supertest/types';

/**
 * Security hardening pass, item 7 — background jobs run with no tenant context.
 *
 * A cron has no request, so `app.current_org` and `app.current_user` are both
 * unset and every row-level security policy keyed on them matches nothing. A
 * sweep written as `repo.find({ status: ACTIVE })` therefore returns zero rows
 * for every organisation on the platform, and the job logs a healthy
 * "processed 0" — the commitment-chase failure from Portal 1, repeated.
 *
 * WHY THESE TESTS CONNECT AS `graddly_app`:
 *
 * The row-count probes use `createAppDbClient()`, the NOSUPERUSER role the
 * deployed application uses. Connecting as the superuser would make every
 * probe pass regardless of the fix, because Postgres does not apply RLS to it
 * at all — which is precisely how this class of bug survived for so long.
 *
 * The service-level tests run through the Nest app, whose own connection is
 * also `graddly_app` (`.env.test`), so they exercise the real thing.
 */
describe('Cron tenant context (e2e)', () => {
  let app: INestApplication<App>;
  let appDb: Client;

  beforeAll(async () => {
    app = await createE2eApp();
    appDb = createAppDbClient();
    await appDb.connect();
  });

  afterAll(async () => {
    await appDb?.end();
    await app?.close();
  });

  /**
   * The probe that originally found this bug, kept as a regression test.
   *
   * It asserts the *mechanism* rather than any one service: with no tenant
   * context an organisation-scoped read returns nothing, and with the
   * bootstrap flag it returns the row. If this ever stops holding, the
   * premise behind every bootstrap call in the codebase has changed and the
   * service-level tests below would start passing for the wrong reason.
   */
  it('proves an org-scoped read returns nothing without context', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cron-probe');

    // A cron's actual state: no user, no org, no bootstrap.
    await appDb.query(
      `SELECT set_config('app.current_user','',false),
              set_config('app.current_org','',false),
              set_config('app.rls_bootstrap','0',false)`,
    );
    const blind = await appDb.query<{ count: string }>(
      `SELECT count(*) FROM enrolments WHERE id = $1`,
      [ctx.enrolmentId],
    );
    expect(Number(blind.rows[0].count)).toBe(0);

    // The same query with the flag a cron is supposed to set.
    await appDb.query(`SELECT set_config('app.rls_bootstrap','1',false)`);
    const sighted = await appDb.query<{ count: string }>(
      `SELECT count(*) FROM enrolments WHERE id = $1`,
      [ctx.enrolmentId],
    );
    expect(Number(sighted.rows[0].count)).toBe(1);

    // Leave the connection scoped, so a later test cannot inherit bootstrap.
    await setTenantGucs(appDb, ctx.owner.userId, ctx.providerOrgId);
  });

  /**
   * Clears the ambient context the way a freshly-fired cron sees it.
   *
   * Without this the test would inherit whatever the fixture's HTTP requests
   * left behind and pass even against the unfixed code — the reason this bug
   * was invisible to the existing suite.
   */
  const asCronWithNoContext = async <T>(run: () => Promise<T>): Promise<T> => {
    const previousBootstrap = getRlsBootstrap();
    setCurrentOrganisationId(undefined);
    setCurrentUserId(undefined);
    setRlsBootstrap(false);
    try {
      return await run();
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  };

  it('otj pace sweep sees active enrolments with no ambient context', async () => {
    await createProviderDirectoryContext(app, 'cron-otj');
    const service = app.get(OtjPaceService);

    /**
     * Asserts a NON-ZERO effect — but on the sweep's *read*, not its return
     * value.
     *
     * The obvious assertion, `flagPaceForAllActiveEnrolments() > 0`, is wrong
     * and was tried first: that counter reports how many learners had an alert
     * raised, and a fresh fixture with no off-the-job history correctly raises
     * none. It would have tested the fixture, not the fix.
     *
     * What the bug actually did was make the sweep read zero rows. So the
     * observable is how many enrolments `evaluateEnrolmentPace` was handed —
     * greater than zero proves the tenant-scoped read returned data with no
     * ambient context, which is exactly what regressed.
     */
    const evaluate = jest.spyOn(service, 'evaluateEnrolmentPace');

    try {
      await asCronWithNoContext(() => service.flagPaceForAllActiveEnrolments());
      expect(evaluate.mock.calls.length).toBeGreaterThan(0);
    } finally {
      evaluate.mockRestore();
    }
  });

  it('caseload sweep checks organisations with no ambient context', async () => {
    await createProviderDirectoryContext(app, 'cron-caseload');
    const service = app.get(CaseloadAlertService);

    const result = await asCronWithNoContext(() => service.runSweep());

    /**
     * `organisationsChecked` is the assertion that matters. Before the fix the
     * provider list came back empty, so this was 0 and the sweep reported
     * success having examined nobody.
     *
     * `alertsSent` is deliberately NOT asserted greater than zero: a healthy
     * fixture has no tutor over the at-risk threshold, so zero alerts is the
     * correct outcome. Asserting it would make the test fail for being right.
     */
    expect(result.organisationsChecked).toBeGreaterThan(0);
  });

  /**
   * The second gap found inside `alertForOrganisation` — the membership read
   * that ran before the tenant context was set. If it regresses, the function
   * takes its `managers.length === 0` early return and never reaches the
   * caseload query, so `organisationsChecked` stays positive while nothing is
   * actually examined. This asserts the managers were genuinely resolved.
   */
  it('resolves organisation managers during the caseload sweep', async () => {
    const ctx = await createProviderDirectoryContext(app, 'cron-managers');

    await setTenantGucs(appDb, ctx.owner.userId, ctx.providerOrgId);
    const managers = await appDb.query<{ count: string }>(
      `SELECT count(*) FROM organisation_memberships
        WHERE "organisationId" = $1 AND "isDeleted" = false`,
      [ctx.providerOrgId],
    );

    // The fixture must actually have a manager, or the test above proves
    // nothing about the membership read.
    expect(Number(managers.rows[0].count)).toBeGreaterThan(0);
  });
});
