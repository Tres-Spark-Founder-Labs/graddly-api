import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtjActivityNameAndCategory1780400000000 implements MigrationInterface {
  name = 'AddOtjActivityNameAndCategory1780400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "otj_activity_category" AS ENUM (
        'taught_learning',
        'applied_project',
        'mentoring_coaching',
        'job_shadowing',
        'off_site_learning',
        'other'
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" ADD "activityName" character varying(80)`,
    );
    await queryRunner.query(
      `UPDATE "otj_log_entries"
       SET "activityName" = COALESCE(LEFT("note", 80), 'Untitled activity')
       WHERE "activityName" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" ALTER COLUMN "activityName" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" ADD "category" "otj_activity_category" NOT NULL DEFAULT 'other'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_otj_log_entries_org_category" ON "otj_log_entries" ("organisationId", "category")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_otj_log_entries_org_category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" DROP COLUMN "category"`,
    );
    await queryRunner.query(
      `ALTER TABLE "otj_log_entries" DROP COLUMN "activityName"`,
    );
    await queryRunner.query(`DROP TYPE "otj_activity_category"`);
  }
}
