import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

export class CreateMessagingTables1780600000001 implements MigrationInterface {
  name = 'CreateMessagingTables1780600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "message_thread_party" AS ENUM ('tutor', 'employer_manager')`,
    );

    await queryRunner.query(
      `CREATE TABLE "message_threads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "enrolmentId" uuid NOT NULL,
        "apprenticeId" uuid NOT NULL,
        "counterpartyParty" "message_thread_party" NOT NULL,
        "apprenticeUserId" uuid NOT NULL,
        "counterpartyUserId" uuid NOT NULL,
        "archivedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_message_threads" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "threadId" uuid NOT NULL,
        "senderUserId" uuid NOT NULL,
        "body" text NOT NULL,
        CONSTRAINT "PK_messages" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "message_attachments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "messageId" uuid NOT NULL,
        "storageKey" character varying(1024) NOT NULL,
        "filename" character varying(255) NOT NULL,
        "contentType" character varying(127) NOT NULL,
        "contentLength" integer NOT NULL,
        CONSTRAINT "PK_message_attachments" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "message_thread_reads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "organisationId" uuid NOT NULL,
        "threadId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "lastReadAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_message_thread_reads" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_message_thread_reads_thread_user" UNIQUE ("threadId", "userId")
      )`,
    );

    await queryRunner.query(
      `ALTER TABLE "message_threads" ADD CONSTRAINT "FK_message_threads_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_threads" ADD CONSTRAINT "FK_message_threads_enrolmentId" FOREIGN KEY ("enrolmentId") REFERENCES "enrolments"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_threads" ADD CONSTRAINT "FK_message_threads_apprenticeId" FOREIGN KEY ("apprenticeId") REFERENCES "apprentices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_threadId" FOREIGN KEY ("threadId") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "message_attachments" ADD CONSTRAINT "FK_message_attachments_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_attachments" ADD CONSTRAINT "FK_message_attachments_messageId" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "message_thread_reads" ADD CONSTRAINT "FK_message_thread_reads_organisationId" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_thread_reads" ADD CONSTRAINT "FK_message_thread_reads_threadId" FOREIGN KEY ("threadId") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_message_threads_enrolment_party" ON "message_threads" ("enrolmentId", "counterpartyParty") WHERE "isDeleted" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_threads_org_enrolment" ON "message_threads" ("organisationId", "enrolmentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_thread_created" ON "messages" ("threadId", "createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_messages_org_thread" ON "messages" ("organisationId", "threadId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_attachments_message" ON "message_attachments" ("messageId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_message_thread_reads_user" ON "message_thread_reads" ("userId", "threadId")`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const table of [
      'message_threads',
      'messages',
      'message_attachments',
      'message_thread_reads',
    ]) {
      await queryRunner.query(`
CREATE POLICY ${table}_select ON "${table}"
  FOR SELECT
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      await queryRunner.query(`
CREATE POLICY ${table}_insert ON "${table}"
  FOR INSERT
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      await queryRunner.query(`
CREATE POLICY ${table}_update ON "${table}"
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      await queryRunner.query(`
CREATE POLICY ${table}_delete ON "${table}"
  FOR DELETE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'message_thread_reads',
      'message_attachments',
      'messages',
      'message_threads',
    ]) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${table}_delete ON "${table}"`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${table}_update ON "${table}"`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${table}_insert ON "${table}"`,
      );
      await queryRunner.query(
        `DROP POLICY IF EXISTS ${table}_select ON "${table}"`,
      );
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    await queryRunner.query(`DROP TYPE IF EXISTS "message_thread_party"`);
  }
}
