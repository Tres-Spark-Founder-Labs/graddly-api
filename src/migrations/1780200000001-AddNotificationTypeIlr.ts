import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationTypeIlr1780200000001 implements MigrationInterface {
  name = 'AddNotificationTypeIlr1780200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'ilr_submission_succeeded'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'ilr_submission_failed'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot drop individual enum values without recreating the type.
  }
}
