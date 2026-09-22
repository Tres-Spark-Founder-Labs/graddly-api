import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ILR 2025-26 v1 — `LearnAimRef` is `ZPROG001` for the apprenticeship
 * programme aim, not the standard's code.
 *
 * 1780200000000 seeded the published v1 mapping with
 * `LearnAimRef: { source: 'standard.code' }`, so every built record carried
 * the IfATE reference (`ST0116`) where the ILR expects the programme aim. The
 * standard's own identity belongs in `StdCode`, the LARS numeric code, which
 * the platform does not hold (docs/ilr-field-gap.md) — so it is not mapped
 * here rather than mapped wrongly.
 *
 * A correction of the published row in place, not a v2: v1 was wrong, not
 * superseded. Only a row still holding the original mapping is touched, so a
 * hand-corrected config is left as it is. The date fix (`YYYY-MM-DD`) is in
 * the `ilrDate` transform, not the config, and needs nothing here.
 *
 * Records already built keep the fields they were built with until they are
 * rebuilt; the migration does not rewrite them.
 */
export class CorrectIlrV1LearnAimRef1781100000061 implements MigrationInterface {
  name = 'CorrectIlrV1LearnAimRef1781100000061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "ilr_mapping_configs"
          SET "config" = jsonb_set(
                "config",
                '{entities,LearningDelivery,LearnAimRef}',
                '{"source": "constant", "value": "ZPROG001", "required": true}'::jsonb
              ),
              "updatedAt" = now()
        WHERE "academicYear" = '2025-26'
          AND "version" = 1
          AND "config" #>> '{entities,LearningDelivery,LearnAimRef,source}' = 'standard.code'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "ilr_mapping_configs"
          SET "config" = jsonb_set(
                "config",
                '{entities,LearningDelivery,LearnAimRef}',
                '{"source": "standard.code", "required": true}'::jsonb
              ),
              "updatedAt" = now()
        WHERE "academicYear" = '2025-26'
          AND "version" = 1
          AND "config" #>> '{entities,LearningDelivery,LearnAimRef,value}' = 'ZPROG001'`,
    );
  }
}
