import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLevyNotificationTypes1780500000005 implements MigrationInterface {
  name = 'AddLevyNotificationTypes1780500000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'levy_expiry_90'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'levy_expiry_30'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot drop individual enum values without recreating the type.
  }
}
