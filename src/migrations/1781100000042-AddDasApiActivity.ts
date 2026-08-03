import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * F2.3.1 AC5 and AC7 — DAS sync health, and the API activity log behind it.
 *
 * Neither existed. `DasController` had four routes — queue a sync, read the
 * levy balance, read a forecast, read funding payments — and none of them
 * could answer *"is the sync working"*. When a call to the ESFA failed, the
 * only trace was an `InternalServerErrorException` whose message had the
 * status code interpolated into it; that reached a process log and nothing
 * durable. A provider asking whether their submission actually reached the
 * ESFA had no answer, and neither did we.
 *
 * One table, not two. AC5 wants a status indicator (last sync, health band,
 * error count) and AC7 wants the call log; a separate `das_sync_runs` table
 * summarising the same events could disagree with the log it summarises, and
 * the disagreement would surface as a green indicator over a list of failures.
 * The indicator is derived from these rows instead, so it cannot drift.
 *
 * `succeeded` is denormalised rather than computed from `responseStatus`
 * because a timeout has no status code at all, and "we never reached the
 * ESFA" must remain distinguishable from "the ESFA returned 500" — that is
 * the first question anyone asks about a failed submission. It also gives the
 * partial index something concrete to filter on.
 *
 * NOTE ON CREDENTIALS: `requestSummary` is scrubbed by
 * `das-activity-scrub.util.ts` before it is written, and the Authorization
 * header is never copied here at all. An audit table is long-lived, widely
 * readable and exported; one that leaks bearer tokens is worse than having no
 * audit table.
 */
export class AddDasApiActivity1781100000042 implements MigrationInterface {
  name = 'AddDasApiActivity1781100000042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "das_api_operation" AS ENUM (
        'oauth_token',
        'levy_balance',
        'funding_payments',
        'enrolment_submit',
        'completion_notify',
        'transfer_consent',
        'transfer_status'
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "das_api_activity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "operation" "das_api_operation" NOT NULL,
        "method" character varying(10) NOT NULL,
        "url" text NOT NULL,
        "responseStatus" integer,
        "succeeded" boolean NOT NULL DEFAULT false,
        "durationMs" integer NOT NULL,
        "errorMessage" text,
        "requestSummary" jsonb,
        "triggeredByUserId" uuid,
        CONSTRAINT "PK_das_api_activity" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "das_api_activity" ADD CONSTRAINT "FK_das_api_activity_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // SET NULL: removing a staff account must not erase the record of what
    // was sent to the ESFA on their watch.
    await queryRunner.query(
      `ALTER TABLE "das_api_activity" ADD CONSTRAINT "FK_das_api_activity_triggeredByUserId" FOREIGN KEY ("triggeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // The log is always read newest-first for one organisation.
    await queryRunner.query(
      `CREATE INDEX "IDX_das_api_activity_org_created" ON "das_api_activity" ("organisationId", "createdAt")`,
    );
    // AC5's health read only ever asks for failures, which are a small
    // minority of a table that gains a row on every call.
    await queryRunner.query(
      `CREATE INDEX "IDX_das_api_activity_org_failures" ON "das_api_activity" ("organisationId", "createdAt") WHERE "succeeded" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY das_api_activity_select ON das_api_activity
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY das_api_activity_insert ON das_api_activity
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    /**
     * No UPDATE or DELETE policy, deliberately.
     *
     * This is a record of what was sent to a government funding body. Rows are
     * written once and never revised: an activity log that can be edited after
     * the fact answers a different, much weaker question than the one AC7
     * asks. Retention pruning runs as the migration role, which is not subject
     * to these policies.
     */

    await queryRunner.query(
      `ALTER TABLE das_api_activity ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE das_api_activity FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE das_api_activity NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE das_api_activity DISABLE ROW LEVEL SECURITY`,
    );
    for (const policy of [
      'das_api_activity_insert',
      'das_api_activity_select',
    ]) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${policy} ON das_api_activity`,
      );
    }
    await queryRunner.query(
      `DROP INDEX "public"."IDX_das_api_activity_org_failures"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_das_api_activity_org_created"`,
    );
    await queryRunner.query(`DROP TABLE "das_api_activity"`);
    await queryRunner.query(`DROP TYPE "das_api_operation"`);
  }
}
