import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserMfaColumns1781100000016 implements MigrationInterface {
  name = 'AddUserMfaColumns1781100000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "mfaEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD "mfaSecret" text`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "mfaRecoveryCodes" text[]`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "mfaRecoveryCodes"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "mfaSecret"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "mfaEnabled"`);
  }
}
