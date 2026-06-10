import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnrolmentJourneyAndPace1781000000006 implements MigrationInterface {
  name = 'AddEnrolmentJourneyAndPace1781000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "otj_pace_alert_level" AS ENUM ('on_track', 'at_risk', 'off_track')
    `);

    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "epaDate" date
    `);
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "otjPaceAlertLevel" "otj_pace_alert_level"
    `);
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "otjPaceAlertedAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "gatewayReadyNotifiedAt" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      ALTER TABLE "standards"
      ADD COLUMN "gatewayCriteria" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "standards" DROP COLUMN "gatewayCriteria"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "gatewayReadyNotifiedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "otjPaceAlertedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "otjPaceAlertLevel"`,
    );
    await queryRunner.query(`ALTER TABLE "enrolments" DROP COLUMN "epaDate"`);
    await queryRunner.query(`DROP TYPE "otj_pace_alert_level"`);
  }
}
