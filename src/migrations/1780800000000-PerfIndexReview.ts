import { MigrationInterface, QueryRunner } from 'typeorm';

export class PerfIndexReview1780800000000 implements MigrationInterface {
  name = 'PerfIndexReview1780800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_otj_log_entries_org_created"
      ON "otj_log_entries" ("organisationId", "createdAt" DESC)
      WHERE "isDeleted" = false
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_log_org_entity_created"
      ON "audit_log_entries" ("organisationId", "entityType", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_notifications_user_unread"
      ON "notifications" ("userId")
      WHERE "isDeleted" = false AND "readAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_enrolments_active_status"
      ON "enrolments" ("status")
      WHERE "isDeleted" = false
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_enrolments_org_provider_org"
      ON "enrolments" ("organisationId", "providerOrganisationId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_enrolments_org_provider_org"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_enrolments_active_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notifications_user_unread"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_audit_log_org_entity_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_otj_log_entries_org_created"`,
    );
  }
}
