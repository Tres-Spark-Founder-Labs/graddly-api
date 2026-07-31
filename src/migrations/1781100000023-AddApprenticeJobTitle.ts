import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.2.5 AC1 — the enrolment form captures the apprentice's job title.
 *
 * `jobTitle` existed on `users` but not on `apprentices`, and the two are not
 * the same record: an apprentice has a row from the moment the employer
 * enrols them, whereas a user only exists once they accept the invitation and
 * create a Portal 3 account. Storing the job title on the user would mean the
 * employer types it during enrolment and it vanishes until the apprentice
 * signs up — which is exactly what the enrol drawer did, since it collected
 * the field and dropped it on submit.
 *
 * It is the employer's description of the role the apprenticeship supports, so
 * it belongs to the apprentice record the employer owns.
 *
 * Nullable: existing apprentices have none, and it is not required to enrol.
 */
export class AddApprenticeJobTitle1781100000023 implements MigrationInterface {
  name = 'AddApprenticeJobTitle1781100000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "apprentices" ADD "jobTitle" character varying(120)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "apprentices" DROP COLUMN "jobTitle"`);
  }
}
