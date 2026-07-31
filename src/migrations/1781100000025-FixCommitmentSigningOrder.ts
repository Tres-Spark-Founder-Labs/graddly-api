import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrects the signing order on commitment statements that have not been
 * signed yet.
 *
 * The PRD specifies "Provider (P2) creates → Employer (P1) e-signs →
 * Apprentice (P3) e-signs", and F3.4.1 AC6 confirms the direction from the
 * other end: "if the apprentice has not signed within 7 days of the employer
 * signing". The implementation created signature slots in the order
 * apprentice, tutor, employer — the reverse — and `commitment-chase.service.ts`
 * enforces the sequence strictly, so the apprentice was chased first and the
 * employer could only sign once everyone else had.
 *
 * New statements are fixed at the source (`COMMITMENT_SIGNING_ORDER`). This
 * migration handles rows already in the database.
 *
 * **The safety condition matters more than the remap.** Only statements where
 * *no* signature has been collected are touched. Once a party has signed,
 * `signOrder` is part of the record of how a legally binding document was
 * executed: it says who signed in which position. Rewriting that after the
 * fact would misrepresent a signed instrument, which is worse than leaving a
 * handful of in-flight statements on the old sequence. Those will complete
 * under the order they started with, which is at least internally consistent.
 */
export class FixCommitmentSigningOrder1781100000025 implements MigrationInterface {
  name = 'FixCommitmentSigningOrder1781100000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE commitment_signatures cs
SET "signOrder" = CASE cs.party
  WHEN 'tutor' THEN 1
  WHEN 'employer_manager' THEN 2
  WHEN 'apprentice' THEN 3
  ELSE cs."signOrder"
END
WHERE NOT EXISTS (
  SELECT 1
  FROM commitment_signatures signed
  WHERE signed."statementId" = cs."statementId"
    AND signed.status = 'signed'
)`);
  }

  /**
   * Restores the previous order, under the same condition. Statements that
   * have started collecting signatures since `up` ran are left alone for the
   * same reason they were left alone then.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE commitment_signatures cs
SET "signOrder" = CASE cs.party
  WHEN 'apprentice' THEN 1
  WHEN 'tutor' THEN 2
  WHEN 'employer_manager' THEN 3
  ELSE cs."signOrder"
END
WHERE NOT EXISTS (
  SELECT 1
  FROM commitment_signatures signed
  WHERE signed."statementId" = cs."statementId"
    AND signed.status = 'signed'
)`);
  }
}
