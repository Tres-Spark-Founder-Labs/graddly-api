import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIlrSubmissionRequestedByUserId1780800000003 implements MigrationInterface {
  name = 'AddIlrSubmissionRequestedByUserId1780800000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE "ilr_submissions"
  ADD COLUMN "requestedByUserId" uuid NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE "ilr_submissions" DROP COLUMN "requestedByUserId"`);
  }
}
