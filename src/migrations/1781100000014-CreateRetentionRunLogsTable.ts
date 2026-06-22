import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRetentionRunLogsTable1781100000014 implements MigrationInterface {
  name = 'CreateRetentionRunLogsTable1781100000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "retention_run_triggered_by" AS ENUM ('cron', 'manual')`,
    );

    await queryRunner.query(
      `CREATE TABLE "retention_run_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "ranAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "triggeredBy" "retention_run_triggered_by" NOT NULL,
        "auditLogsPurged" integer NOT NULL,
        "softDeletedPurged" integer NOT NULL,
        "oldNotificationsPurged" integer NOT NULL,
        CONSTRAINT "PK_retention_run_logs" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_retention_run_logs_ranAt" ON "retention_run_logs" ("ranAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_retention_run_logs_ranAt"`);
    await queryRunner.query(`DROP TABLE "retention_run_logs"`);
    await queryRunner.query(`DROP TYPE "retention_run_triggered_by"`);
  }
}
