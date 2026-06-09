import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnrolmentOrganisationLinks1780700000000 implements MigrationInterface {
  name = 'AddEnrolmentOrganisationLinks1780700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD COLUMN "employerOrganisationId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD COLUMN "providerOrganisationId" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD CONSTRAINT "FK_enrolments_employerOrganisationId"
      FOREIGN KEY ("employerOrganisationId") REFERENCES "organisations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "enrolments"
      ADD CONSTRAINT "FK_enrolments_providerOrganisationId"
      FOREIGN KEY ("providerOrganisationId") REFERENCES "organisations"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_enrolments_org_employer_org"
      ON "enrolments" ("organisationId", "employerOrganisationId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_enrolments_org_employer_org"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP CONSTRAINT "FK_enrolments_providerOrganisationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP CONSTRAINT "FK_enrolments_employerOrganisationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "providerOrganisationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "employerOrganisationId"`,
    );
  }
}
