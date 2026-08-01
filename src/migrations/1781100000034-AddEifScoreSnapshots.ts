import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * F2.1.1 — storage for the twelve-month EIF trend.
 *
 * Nothing has ever persisted an EIF score. They are computed on demand and
 * cached in Redis for an hour, so the platform has never held one for longer
 * than that. The trend chart the criterion asks for cannot be drawn from a
 * cache that forgets hourly, and it cannot be back-filled — the score is a
 * function of the OTJ logs, reviews and documents as they stood on the day,
 * and those have moved on.
 *
 * This lands ahead of the feature deliberately. History accrues in wall-clock
 * time: every day the snapshot is not running is a day of trend data nobody
 * can recover later.
 *
 * `eif_rag` becomes a Postgres type here for the first time, for the same
 * reason — the RAG rating was only ever a TypeScript enum on a computed
 * value.
 */
export class AddEifScoreSnapshots1781100000034 implements MigrationInterface {
  name = 'AddEifScoreSnapshots1781100000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "eif_rag" AS ENUM ('red', 'amber', 'green')`,
    );

    await queryRunner.query(
      `CREATE TABLE "eif_score_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "capturedOn" date NOT NULL,
        "overallPercent" integer NOT NULL,
        "overallRag" "eif_rag" NOT NULL,
        "criteria" jsonb NOT NULL,
        CONSTRAINT "PK_eif_score_snapshots" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "eif_score_snapshots" ADD CONSTRAINT "FK_eif_score_snapshots_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    /**
     * One point per organisation per day, enforced rather than assumed: the
     * cron can be re-run, retried by the scheduler, or triggered manually
     * during an incident, and none of those should put two points on the same
     * day of the chart.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_eif_score_snapshots_org_day" ON "eif_score_snapshots" ("organisationId", "capturedOn") WHERE "isDeleted" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_eif_score_snapshots_org_captured" ON "eif_score_snapshots" ("organisationId", "capturedOn")`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY eif_score_snapshots_select ON eif_score_snapshots
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY eif_score_snapshots_insert ON eif_score_snapshots
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY eif_score_snapshots_update ON eif_score_snapshots
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
    await queryRunner.query(`
CREATE POLICY eif_score_snapshots_delete ON eif_score_snapshots
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

    await queryRunner.query(
      `ALTER TABLE eif_score_snapshots ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE eif_score_snapshots FORCE ROW LEVEL SECURITY`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE eif_score_snapshots NO FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE eif_score_snapshots DISABLE ROW LEVEL SECURITY`,
    );
    for (const action of ['delete', 'update', 'insert', 'select']) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS eif_score_snapshots_${action} ON eif_score_snapshots`,
      );
    }
    await queryRunner.query(
      `DROP INDEX "public"."IDX_eif_score_snapshots_org_captured"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_eif_score_snapshots_org_day"`,
    );
    await queryRunner.query(`DROP TABLE "eif_score_snapshots"`);
    await queryRunner.query(`DROP TYPE "eif_rag"`);
  }
}
