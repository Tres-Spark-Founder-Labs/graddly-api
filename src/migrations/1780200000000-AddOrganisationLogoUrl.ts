import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrganisationLogoUrl1780200000000 implements MigrationInterface {
  name = 'AddOrganisationLogoUrl1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable additive column: existing rows default to NULL, no backfill needed.
    await queryRunner.query(
      `ALTER TABLE "organisations" ADD "logoUrl" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organisations" DROP COLUMN "logoUrl"`,
    );
  }
}
