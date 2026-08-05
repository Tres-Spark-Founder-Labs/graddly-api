import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * Security hardening pass, item 4 — a write gap created by item 1's read fix.
 *
 * Item 1 gave the thread counterparty (usually an employer manager) SELECT on
 * `message_threads` and `messages`, so their inbox finally worked. Their
 * writes were left owner-scoped, which was the correct default — but for
 * messaging it is wrong, because replying *is* the feature.
 *
 * `MessagesService.create` stamps `organisationId: thread.organisationId` —
 * the provider's org — while `messages_insert` requires
 * `organisationId = app_current_org()`. For an employer manager those differ,
 * so the insert was refused. Same for `markRead`, which stamps the thread's
 * organisation onto `message_thread_reads`.
 *
 * Net effect: the employer could read the conversation and neither reply to it
 * nor mark it read.
 *
 * These policies are narrow and additive, matching
 * `MessagingAccessService.isParticipant` — the rule the service already
 * enforces — rather than widening the owner rule. Only the two named
 * participants of a thread gain the write; nobody else at either organisation
 * does.
 *
 * `messages` UPDATE and DELETE are deliberately NOT widened: editing or
 * deleting a sent message is not something this product offers to anyone, and
 * a read fix must not quietly add it.
 */
export class MessagingParticipantWrites1781100000048 implements MigrationInterface {
  name = 'MessagingParticipantWrites1781100000048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await ensureRlsHelperFunctions(queryRunner);

    await queryRunner.query(`
CREATE POLICY messages_insert_participant ON messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM message_threads t
      WHERE t.id = messages."threadId"
        AND t."isDeleted" = false
        AND (
          t."apprenticeUserId" = app_current_user()
          OR t."counterpartyUserId" = app_current_user()
        )
    )
  )`);

    /**
     * Marking a thread read is per-user bookkeeping, so both arms are keyed on
     * the acting user: they may only write their own read-marker, and only on
     * a thread they participate in.
     */
    await queryRunner.query(`
CREATE POLICY message_thread_reads_insert_participant ON message_thread_reads
  FOR INSERT
  WITH CHECK (
    "userId" = app_current_user()
    AND EXISTS (
      SELECT 1
      FROM message_threads t
      WHERE t.id = message_thread_reads."threadId"
        AND t."isDeleted" = false
        AND (
          t."apprenticeUserId" = app_current_user()
          OR t."counterpartyUserId" = app_current_user()
        )
    )
  )`);

    await queryRunner.query(`
CREATE POLICY message_thread_reads_update_participant ON message_thread_reads
  FOR UPDATE
  USING ("userId" = app_current_user())
  WITH CHECK ("userId" = app_current_user())`);

    await queryRunner.query(`
CREATE POLICY message_thread_reads_select_own ON message_thread_reads
  FOR SELECT
  USING ("userId" = app_current_user())`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, policy] of [
      ['messages', 'messages_insert_participant'],
      ['message_thread_reads', 'message_thread_reads_insert_participant'],
      ['message_thread_reads', 'message_thread_reads_update_participant'],
      ['message_thread_reads', 'message_thread_reads_select_own'],
    ] as const) {
      await queryRunner.query(`DROP POLICY IF EXISTS ${policy} ON ${table}`);
    }
  }
}
