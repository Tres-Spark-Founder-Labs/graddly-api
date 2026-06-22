import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFlowportalRegistrationSessions1781100000010 implements MigrationInterface {
  name = 'CreateFlowportalRegistrationSessions1781100000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "registration_session_status" AS ENUM ('in_progress', 'completed', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TYPE "registration_wizard_step" AS ENUM ('company_verification', 'paye_reference', 'das_account', 'bank_details', 'consent')`,
    );
    await queryRunner.query(
      `CREATE TABLE "flowportal_registration_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "resumeTokenHash" character varying(64) NOT NULL,
        "status" "registration_session_status" NOT NULL DEFAULT 'in_progress',
        "currentStep" "registration_wizard_step" NOT NULL DEFAULT 'company_verification',
        "contactEmail" character varying(320),
        "stepPayload" jsonb NOT NULL DEFAULT '{}',
        "companiesHouseNumber" character varying(20),
        "companyName" character varying(255),
        "payeReference" character varying(32),
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_flowportal_registration_sessions" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_flowportal_registration_sessions_resume_token" ON "flowportal_registration_sessions" ("resumeTokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_flowportal_registration_sessions_status_expires" ON "flowportal_registration_sessions" ("status", "expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_flowportal_registration_sessions_status_expires"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_flowportal_registration_sessions_resume_token"`,
    );
    await queryRunner.query(`DROP TABLE "flowportal_registration_sessions"`);
    await queryRunner.query(`DROP TYPE "registration_wizard_step"`);
    await queryRunner.query(`DROP TYPE "registration_session_status"`);
  }
}
