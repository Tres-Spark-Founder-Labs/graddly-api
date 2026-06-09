import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnrolmentParticipantUserIds1780600000000 implements MigrationInterface {
  name = 'AddEnrolmentParticipantUserIds1780600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD COLUMN "apprenticeUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD COLUMN "tutorUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD COLUMN "employerManagerUserId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "employerManagerUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "tutorUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "apprenticeUserId"`,
    );
  }
}
