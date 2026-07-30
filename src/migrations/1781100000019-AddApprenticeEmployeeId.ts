import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.2.1 AC5 — search apprentices by name or employee ID.
 *
 * No employee/payroll identifier existed anywhere in the API: the Apprentice
 * entity carried only firstName, lastName, email and status. The employer
 * frontend already had `employeeId: null` with a "not in API" comment, so the
 * column was being rendered as absent rather than wrongly.
 *
 * Adding it rather than cutting the criterion, because HR and line managers
 * identify people by payroll number — an apprentice roster searchable only by
 * name is awkward for exactly the users this portal is for.
 *
 * Nullable by design: it is the employer's own reference, not something the
 * platform can derive, and existing apprentices have none. Not unique either —
 * a scheme spanning multiple employers cannot assume payroll numbers do not
 * collide across them.
 */
export class AddApprenticeEmployeeId1781100000019 implements MigrationInterface {
  name = 'AddApprenticeEmployeeId1781100000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "apprentices" ADD "employeeId" character varying(64)`,
    );

    // Supports AC5's search without scanning: case-insensitive prefix match
    // scoped to the organisation, which is how the roster always queries.
    await queryRunner.query(
      `CREATE INDEX "IDX_apprentices_org_employee_id" ON "apprentices" ("organisationId", LOWER("employeeId")) WHERE "employeeId" IS NOT NULL AND "isDeleted" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_apprentices_org_employee_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "apprentices" DROP COLUMN "employeeId"`,
    );
  }
}
