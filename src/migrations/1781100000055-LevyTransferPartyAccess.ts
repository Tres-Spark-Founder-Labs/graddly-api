import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * Levy transfers, run under enforced RLS for both parties (F4.2.4).
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 *
 * `rls-bootstrap.middleware.ts` turned RLS off for every POST whose path
 * contained `/levy-exchange/transfers` — create, sign, submit and enrolment
 * links — so the service's `where` clauses were the only tenant boundary on
 * all four. GETs were not bypassed, and `levy_transfer_documents_select` was
 * owner-only while the document row belongs to the donor, so the recipient
 * could sign an agreement it could never open: 404 on GET /document before
 * either signature, after the donor's, and after both.
 *
 * The bypass is removed in the same change. What the transfer routes
 * genuinely need across the tenant line is granted here, and nothing else.
 *
 * ── THE AGREEMENT IS ONE BILATERAL DOCUMENT ─────────────────────────────────
 *
 * One document row, owned by the donor, readable by the recipient — option
 * (a), in the shape of migrations 1781100000047 and 1781100000054: additive,
 * keyed through `levy_transfers`. The alternative, a recipient-owned second
 * row, would still need the donor to create a row inside the recipient's
 * tenant at transfer creation, a backfill for every existing transfer, and two
 * rows kept in step. Each party's lasting copy of the signed PDF is a storage
 * question, answered by `recipientSignedStorageKey` beside the donor's
 * `signedStorageKey`.
 *
 * ── WHY TWO WRITES CROSS THE LINE, AND HOW NARROWLY ─────────────────────────
 *
 *   1. At creation the donor inserts the recipient's signature slot (the donor
 *      names the recipient's signer). Admitted only for an unsigned
 *      `recipient` slot, owned by the transfer's recipient, on a transfer the
 *      current org is the donor of.
 *   2. The recipient signs last and closes the agreement. Admitted only as the
 *      transition `ready` → `signed`, on a transfer the current org is the
 *      recipient of. It stays an ORM save so the audit subscriber records it.
 *
 * Permissive policies OR their USING and their WITH CHECK separately. A
 * recipient admitted by (2)'s USING could otherwise write a new row that
 * passes the OWNER policy's WITH CHECK by setting "organisationId" to itself —
 * taking the donor's row. The RESTRICTIVE policy below pins ownership to the
 * transfer's donor on every update, whoever makes it. It is the first
 * restrictive policy in this schema, and that is the reason for it.
 *
 * ── WHY BOTH PARTIES READ BOTH SIGNATURE SLOTS ──────────────────────────────
 *
 * `sign` decides who is next and whether anyone remains from the slots it can
 * see. With owner-only reads, the donor's own signature would see no remaining
 * slot and mark the transfer fully signed after one signature, and the
 * recipient could never see that the donor had signed at all.
 *
 * ── THE TWO READS THAT STAY IN THE SERVICE ──────────────────────────────────
 *
 * No policy here covers submit's read of the recipient's UKPRN, or the
 * enrolment link's read of the transfer. Each is a single named read by a
 * caller that is party to the record but not to that row: the donor sending
 * the recipient's UKPRN to ESFA, and the enrolment's owner checking the
 * transfer it is attaching a learner to. Both happen inside a narrow
 * `setRlsBootstrap` window in the service, after that caller has been
 * authorised on something it does own — the rule recorded on
 * `setRlsBootstrap` and in `docs/employer-learner-access.md`.
 *
 * Neither is a route bypass. `rls-bootstrap.middleware.ts` no longer matches
 * any transfer route: a route bypass turned the tenant boundary off for a
 * whole request in order to serve one read, where the window is the read.
 */
export class LevyTransferPartyAccess1781100000055 implements MigrationInterface {
  name = 'LevyTransferPartyAccess1781100000055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(
      `ALTER TABLE "levy_transfer_documents" ADD "recipientSignedStorageKey" character varying(500)`,
    );

    /** The recipient reads the agreement, at every stage. */
    await queryRunner.query(`
CREATE POLICY levy_transfer_documents_select_recipient ON levy_transfer_documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM levy_transfers t
      WHERE t.id = levy_transfer_documents."transferId"
        AND t."isDeleted" = false
        AND t."recipientOrganisationId" = app_current_org()
    )
  )`);

    /** The recipient's final signature closes the agreement: ready → signed. */
    await queryRunner.query(`
CREATE POLICY levy_transfer_documents_update_recipient_completes ON levy_transfer_documents
  FOR UPDATE
  USING (
    status = 'ready'
    AND EXISTS (
      SELECT 1
      FROM levy_transfers t
      WHERE t.id = levy_transfer_documents."transferId"
        AND t."isDeleted" = false
        AND t."recipientOrganisationId" = app_current_org()
    )
  )
  WITH CHECK (
    status = 'signed'
    AND EXISTS (
      SELECT 1
      FROM levy_transfers t
      WHERE t.id = levy_transfer_documents."transferId"
        AND t."isDeleted" = false
        AND t."recipientOrganisationId" = app_current_org()
    )
  )`);

    /** Whoever updates a document, it still belongs to its transfer's donor. */
    await queryRunner.query(`
CREATE POLICY levy_transfer_documents_owner_is_donor ON levy_transfer_documents
  AS RESTRICTIVE
  FOR UPDATE
  USING (true)
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM levy_transfers t
      WHERE t.id = levy_transfer_documents."transferId"
        AND t."donorOrganisationId" = levy_transfer_documents."organisationId"
    )
  )`);

    /** Either party reads both slots: sign cannot order them otherwise. */
    await queryRunner.query(`
CREATE POLICY levy_transfer_signatures_select_party ON levy_transfer_signatures
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM levy_transfers t
      WHERE t.id = levy_transfer_signatures."transferId"
        AND t."isDeleted" = false
        AND (
          t."donorOrganisationId" = app_current_org()
          OR t."recipientOrganisationId" = app_current_org()
        )
    )
  )`);

    /** At creation the donor inserts the recipient's empty slot, and only that. */
    await queryRunner.query(`
CREATE POLICY levy_transfer_signatures_insert_recipient_slot ON levy_transfer_signatures
  FOR INSERT
  WITH CHECK (
    party = 'recipient'
    AND "signedAt" IS NULL
    AND "signatureRecordId" IS NULL
    AND EXISTS (
      SELECT 1
      FROM levy_transfers t
      WHERE t.id = levy_transfer_signatures."transferId"
        AND t."isDeleted" = false
        AND t."donorOrganisationId" = app_current_org()
        AND t."recipientOrganisationId" = levy_transfer_signatures."organisationId"
        AND t.status IN ('draft', 'pending_signatures')
    )
  )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, policy] of [
      [
        'levy_transfer_signatures',
        'levy_transfer_signatures_insert_recipient_slot',
      ],
      ['levy_transfer_signatures', 'levy_transfer_signatures_select_party'],
      ['levy_transfer_documents', 'levy_transfer_documents_owner_is_donor'],
      [
        'levy_transfer_documents',
        'levy_transfer_documents_update_recipient_completes',
      ],
      ['levy_transfer_documents', 'levy_transfer_documents_select_recipient'],
    ] as const) {
      await queryRunner.query(`DROP POLICY IF EXISTS ${policy} ON ${table}`);
    }
    await queryRunner.query(
      `ALTER TABLE "levy_transfer_documents" DROP COLUMN "recipientSignedStorageKey"`,
    );
  }
}
