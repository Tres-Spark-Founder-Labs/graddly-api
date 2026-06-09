import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNotificationTypeMessage1780600000002 implements MigrationInterface {
  name = 'AddNotificationTypeMessage1780600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'message'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing enum values safely.
  }
}
