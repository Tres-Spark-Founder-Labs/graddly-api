import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * F1.2.2 AC5 — an employer's document library where the documents can be
 * downloaded.
 *
 * ── THE FAULT ───────────────────────────────────────────────────────────────
 *
 * `pdf_generation_jobs_select` (1779500000000) admits the owning organisation
 * only. Commitment statements and reviews keep their generated PDF as a
 * `snapshotPdfJobId` pointing at that table, and the job is owned by the
 * provider. So for an employer the document row itself is visible — migrations
 * 1781100000018 and 1781100000024 admitted the linked party to reviews and
 * commitment statements — but the read that turns the row into a storage key
 * returns nothing, and the library lists a document with a null `storageKey`
 * and no `downloadUrl`. Listed, not downloadable, which AC5 does not accept.
 *
 * ── THE JOIN, WHICH THE TABLE'S SHAPE DECIDES ───────────────────────────────
 *
 * `pdf_generation_jobs` carries no enrolment reference — its columns are the
 * organisation, the requester, the template, status, output key, error and
 * completion time. The only way from a job to an enrolment is through the
 * document that recorded it: `commitment_statements."snapshotPdfJobId"` (then
 * the statement's group, which is what carries the enrolment) and
 * `reviews."snapshotPdfJobId"`. Two branches, one per document type; a job no
 * document points at — a hello-world render, a levy ROI report — matches
 * neither and stays owner-only.
 *
 * Both branches run under row-level security themselves: Postgres applies a
 * referenced table's policies inside a policy expression, so the employer
 * arm only ever matches through statements, groups and reviews it is already
 * admitted to. `commitment_statements` has no `isDeleted` column (noted in
 * 1781100000024), so the group's is the one filtered on.
 *
 * ── THE SHAPE IS 1781100000047's AND 1781100000054's ────────────────────────
 *
 * Employer only — the provider owns the job and is admitted by the original
 * policy — EXISTS over enrolments, `isDeleted = false`,
 * `employerOrganisationId = app_current_org()`. Like its siblings, the
 * predicate does not filter on enrolment status: a withdrawn or completed
 * learner's employer can still read the documents of that enrolment.
 * Inherited deliberately rather than decided here, so that the four policies
 * answer the same question the same way.
 */
export class EmployerReadsPdfJobs1781100000056 implements MigrationInterface {
  name = 'EmployerReadsPdfJobs1781100000056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE POLICY pdf_generation_jobs_select_employer ON pdf_generation_jobs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM commitment_statements cs
      JOIN commitment_statement_groups g ON g.id = cs."groupId"
      JOIN enrolments e ON e.id = g."enrolmentId"
      WHERE cs."snapshotPdfJobId" = pdf_generation_jobs.id
        AND g."isDeleted" = false
        AND e."isDeleted" = false
        AND e."employerOrganisationId" = app_current_org()
    )
    OR EXISTS (
      SELECT 1
      FROM reviews r
      JOIN enrolments e ON e.id = r."enrolmentId"
      WHERE r."snapshotPdfJobId" = pdf_generation_jobs.id
        AND r."isDeleted" = false
        AND e."isDeleted" = false
        AND e."employerOrganisationId" = app_current_org()
    )
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS pdf_generation_jobs_select_employer ON pdf_generation_jobs`,
    );
  }
}
