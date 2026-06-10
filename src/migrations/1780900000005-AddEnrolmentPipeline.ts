import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnrolmentPipeline1780900000005 implements MigrationInterface {
  name = 'AddEnrolmentPipeline1780900000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "enrolment_pipeline_state" AS ENUM (
        'invited',
        'account_created',
        'provider_accepted',
        'ilr_created',
        'das_confirmed'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "pipelineState" "enrolment_pipeline_state"
    `);
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "pipelineInvitedAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "pipelineAccountCreatedAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "pipelineProviderAcceptedAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "pipelineIlrCreatedAt" TIMESTAMPTZ
    `);
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD COLUMN "pipelineDasConfirmedAt" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      ALTER TABLE "invitations"
      ADD COLUMN "enrolmentId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "invitations"
      ADD CONSTRAINT "FK_invitations_enrolmentId"
      FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_invitations_enrolmentId"
      ON "invitations" ("enrolmentId")
      WHERE "enrolmentId" IS NOT NULL AND "isDeleted" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_invitations_enrolmentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_invitations_enrolmentId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP COLUMN "enrolmentId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "pipelineDasConfirmedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "pipelineIlrCreatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "pipelineProviderAcceptedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "pipelineAccountCreatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "pipelineInvitedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "pipelineState"`,
    );
    await queryRunner.query(`DROP TYPE "enrolment_pipeline_state"`);
  }
}
