import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.3.3 AC3 — "audit trail is exportable as PDF in Ofsted-ready format".
 *
 * The export was JSON and CSV only. Both are org-wide dumps of column diffs;
 * neither identifies the commitment statement it belongs to, and neither is
 * something an inspector would accept as an evidence document.
 */
export class AddCommitmentAuditTrailPdfTemplate1781100000030 implements MigrationInterface {
  name = 'AddCommitmentAuditTrailPdfTemplate1781100000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "pdf_job_template" ADD VALUE IF NOT EXISTS 'commitment_audit_trail'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres enum values cannot be removed safely.
  }
}
