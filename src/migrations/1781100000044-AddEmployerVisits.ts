import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * F2.4.2 — the employer visit log.
 *
 * Entirely new. Nothing in the platform recorded that a tutor had visited an
 * employer, which also meant `EmployerDirectoryEntryResponseDto.lastVisitDate`
 * had been shipped as a hardcoded `null` with an honest note against it
 * ("Reserved for employer visit log (F2.4.2)"). This migration is what lets
 * that field finally hold a value.
 *
 * Two tables. The visit itself, and a join to the learners discussed, because
 * the question that matters runs from the learner: *"when was this apprentice
 * last discussed with their employer?"* is what a tutor asks before a review,
 * and a `uuid[]` column on the visit cannot answer it without scanning every
 * row.
 *
 * `organisationId` on both is the **provider**. The provider owns the record
 * of their own engagement activity; the employer is `employerOrganisationId`.
 * Conflating the two would make a tutor's working notes visible in the
 * employer's portal by default, and "employer unresponsive, chase the MD" is
 * written for the provider's file.
 */
export class AddEmployerVisits1781100000044 implements MigrationInterface {
  name = 'AddEmployerVisits1781100000044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "employer_visit_type" AS ENUM ('on_site', 'video', 'phone')`,
    );

    await queryRunner.query(
      `CREATE TABLE "employer_visits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "employerOrganisationId" uuid NOT NULL,
        "visitedOn" date NOT NULL,
        "visitType" "employer_visit_type" NOT NULL,
        "attendees" text NOT NULL,
        "discussionPoints" text NOT NULL,
        "actionPoints" text,
        "nextVisitDate" date,
        "recordedByUserId" uuid,
        CONSTRAINT "PK_employer_visits" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "employer_visit_learners" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "visitId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        CONSTRAINT "PK_employer_visit_learners" PRIMARY KEY ("id")
      )`,
    );

    for (const [table, column, target, onDelete] of [
      ['employer_visits', 'organisationId', 'organisations', 'CASCADE'],
      ['employer_visits', 'employerOrganisationId', 'organisations', 'CASCADE'],
      // SET NULL: a departed tutor must not erase the evidence that a visit
      // happened. Ofsted asks about the visit, not about who still works here.
      ['employer_visits', 'recordedByUserId', 'users', 'SET NULL'],
      ['employer_visit_learners', 'organisationId', 'organisations', 'CASCADE'],
      ['employer_visit_learners', 'visitId', 'employer_visits', 'CASCADE'],
      ['employer_visit_learners', 'enrolmentId', 'enrolments', 'CASCADE'],
    ] as const) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_${column}" FOREIGN KEY ("${column}") REFERENCES "${target}"("id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    }

    await queryRunner.query(
      `CREATE INDEX "IDX_employer_visits_org_employer_date" ON "employer_visits" ("organisationId", "employerOrganisationId", "visitedOn")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_employer_visits_org_date" ON "employer_visits" ("organisationId", "visitedOn")`,
    );
    // One link per learner per visit. Listing the same apprentice twice on one
    // visit is a UI slip, not a fact worth storing.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_employer_visit_learners_visit_enrolment" ON "employer_visit_learners" ("visitId", "enrolmentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_employer_visit_learners_org_enrolment" ON "employer_visit_learners" ("organisationId", "enrolmentId")`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const table of ['employer_visits', 'employer_visit_learners']) {
      for (const [name, clause] of [
        ['select', 'FOR SELECT\n  USING'],
        ['insert', 'FOR INSERT\n  WITH CHECK'],
        ['delete', 'FOR DELETE\n  USING'],
      ] as const) {
        await queryRunner.query(`
CREATE POLICY ${table}_${name} ON ${table}
  ${clause} (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      }

      await queryRunner.query(`
CREATE POLICY ${table}_update ON ${table}
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }

    /**
     * The visited employer may read their own visit records.
     *
     * Deliberately SELECT only, and deliberately included: an employer being
     * told "we visit you regularly" while being unable to see any record of it
     * is the kind of gap that ends a provider relationship. Writing stays with
     * the provider, whose tutors did the visiting.
     */
    await queryRunner.query(`
CREATE POLICY employer_visits_select_employer ON employer_visits
  FOR SELECT
  USING ("employerOrganisationId" = app_current_org())`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS employer_visits_select_employer ON employer_visits`,
    );

    for (const table of ['employer_visit_learners', 'employer_visits']) {
      await queryRunner.query(
        `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`,
      );
      for (const name of ['update', 'delete', 'insert', 'select']) {
        await queryRunner.query(
          `DROP POLICY IF EXISTS ${table}_${name} ON ${table}`,
        );
      }
    }

    await queryRunner.query(
      `DROP INDEX "public"."IDX_employer_visit_learners_org_enrolment"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_employer_visit_learners_visit_enrolment"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_employer_visits_org_date"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_employer_visits_org_employer_date"`,
    );
    await queryRunner.query(`DROP TABLE "employer_visit_learners"`);
    await queryRunner.query(`DROP TABLE "employer_visits"`);
    await queryRunner.query(`DROP TYPE "employer_visit_type"`);
  }
}
