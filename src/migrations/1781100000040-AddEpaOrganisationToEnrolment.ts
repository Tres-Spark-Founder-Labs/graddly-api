import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F2.2.4 AC1 — "profile contains: ... EPA organisation ...".
 *
 * The end-point assessment organisation appeared nowhere in the platform. The
 * enrolment carried `epaDate` and the EPA outcome carried a grade, but not
 * *who* was assessing. So the learner profile could show when the assessment
 * was and what the result had been, and never who to ring about it.
 *
 * A free-text name rather than a foreign key, deliberately. EPAOs are external
 * bodies on the ESFA register; Gradlly has no organisation record for them and
 * inventing one would mean maintaining a national register nobody asked for.
 * The UKPRN is stored alongside because it is how an EPAO is identified on the
 * ILR, and a name alone is ambiguous — several trading names map to one
 * registration.
 *
 * Both nullable: an EPAO is usually appointed part-way through, not at
 * enrolment, so requiring either would make it impossible to enrol a learner.
 */
export class AddEpaOrganisationToEnrolment1781100000040 implements MigrationInterface {
  name = 'AddEpaOrganisationToEnrolment1781100000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD "epaOrganisationName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" ADD "epaOrganisationUkprn" character varying(8)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "epaOrganisationUkprn"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enrolments" DROP COLUMN "epaOrganisationName"`,
    );
  }
}
