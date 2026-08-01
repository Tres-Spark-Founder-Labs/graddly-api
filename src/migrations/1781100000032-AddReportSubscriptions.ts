import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * F1.4.1 AC5 — "scheduled monthly email delivery to configurable recipients".
 *
 * The distribution list for a scheduled report. See
 * `report-subscription.entity.ts` for why this is its own table rather than
 * another `notification_preferences` row.
 *
 * Standard owner-scoped RLS: a subscription belongs to the employer
 * organisation whose report is being circulated, and no other party has any
 * business reading or changing it.
 */
export class AddReportSubscriptions1781100000032 implements MigrationInterface {
  name = 'AddReportSubscriptions1781100000032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "report_subscription_type" AS ENUM ('levy_roi_monthly')`,
    );

    await queryRunner.query(
      `CREATE TABLE "report_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "reportType" "report_subscription_type" NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "addedByUserId" uuid,
        "lastSentAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_report_subscriptions" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "report_subscriptions" ADD CONSTRAINT "FK_report_subscriptions_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "report_subscriptions" ADD CONSTRAINT "FK_report_subscriptions_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    /**
     * Partial unique index rather than a plain one: soft-deleted rows must not
     * block re-adding somebody who was removed from the list and put back.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_report_subscriptions_org_user_type" ON "report_subscriptions" ("organisationId", "userId", "reportType") WHERE "isDeleted" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_report_subscriptions_type_enabled" ON "report_subscriptions" ("reportType", "enabled") WHERE "isDeleted" = false`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY report_subscriptions_select ON report_subscriptions
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY report_subscriptions_insert ON report_subscriptions
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY report_subscriptions_update ON report_subscriptions
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY report_subscriptions_delete ON report_subscriptions
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(
      `ALTER TABLE report_subscriptions ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE report_subscriptions FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE report_subscriptions NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE report_subscriptions DISABLE ROW LEVEL SECURITY`,
    );
    for (const action of ['delete', 'update', 'insert', 'select']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS report_subscriptions_${action} ON report_subscriptions`,
      );
    }
    await queryRunner.query(
      `DROP INDEX "public"."IDX_report_subscriptions_type_enabled"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_report_subscriptions_org_user_type"`,
    );
    await queryRunner.query(`DROP TABLE "report_subscriptions"`);
    await queryRunner.query(`DROP TYPE "report_subscription_type"`);
  }
}
