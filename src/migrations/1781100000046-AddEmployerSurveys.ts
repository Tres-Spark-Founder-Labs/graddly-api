import { MigrationInterface, QueryRunner } from 'typeorm';

import { ensureRlsHelperFunctions } from './helpers/ensure-rls-helper-functions.js';

/**
 * F2.4.3 — employer satisfaction surveys.
 *
 * Three tables: the reusable template, one campaign per send, and the
 * invitations that carry both the unique link and the answer.
 *
 * TWO DECISIONS WORTH READING BEFORE CHANGING ANYTHING HERE:
 *
 * 1. `survey_campaigns.questions` is a **copy** of the template's questions,
 *    not a reference. Editing a template after a campaign has collected
 *    answers would otherwise rewrite what those answers meant — "strongly
 *    agree" against a question that has since been reworded is evidence of
 *    nothing. A campaign is a historical record and must stay readable as one.
 *
 * 2. `survey_invitations.tokenHash` stores a hash, never the token. The survey
 *    link is a bearer credential: anyone holding it can answer as that
 *    employer, with no login (AC2). A table of live tokens is a table of live
 *    credentials, and this one is readable by every member of the provider
 *    organisation. The plaintext exists in the email and in the API response
 *    to the send call, and nowhere else.
 *
 * The invitation also holds the response. An invitation has at most one
 * answer set, so a separate responses table would add a join to every read of
 * the results dashboard in exchange for a cardinality that cannot occur.
 */
export class AddEmployerSurveys1781100000046 implements MigrationInterface {
  name = 'AddEmployerSurveys1781100000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "survey_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "name" character varying(160) NOT NULL,
        "questions" jsonb NOT NULL,
        CONSTRAINT "PK_survey_templates" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "survey_campaigns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "templateId" uuid,
        "name" character varying(160) NOT NULL,
        "questions" jsonb NOT NULL,
        "closesAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "resultsAvailableAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_survey_campaigns" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "survey_invitations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "isDeleted" boolean NOT NULL DEFAULT false,
        "deletedAt" TIMESTAMP WITH TIME ZONE,
        "organisationId" uuid NOT NULL,
        "campaignId" uuid NOT NULL,
        "employerOrganisationId" uuid,
        "contactEmail" character varying(320) NOT NULL,
        "tokenHash" character varying(64) NOT NULL,
        "respondedAt" TIMESTAMP WITH TIME ZONE,
        "answers" jsonb,
        CONSTRAINT "PK_survey_invitations" PRIMARY KEY ("id")
      )`,
    );

    for (const [table, column, target, onDelete] of [
      ['survey_templates', 'organisationId', 'organisations', 'CASCADE'],
      ['survey_campaigns', 'organisationId', 'organisations', 'CASCADE'],
      ['survey_campaigns', 'templateId', 'survey_templates', 'SET NULL'],
      ['survey_invitations', 'organisationId', 'organisations', 'CASCADE'],
      ['survey_invitations', 'campaignId', 'survey_campaigns', 'CASCADE'],
      [
        'survey_invitations',
        'employerOrganisationId',
        'organisations',
        'SET NULL',
      ],
    ] as const) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_${column}" FOREIGN KEY ("${column}") REFERENCES "${target}"("id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    }

    await queryRunner.query(
      `CREATE INDEX "IDX_survey_templates_org" ON "survey_templates" ("organisationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_campaigns_org_closes" ON "survey_campaigns" ("organisationId", "closesAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_survey_invitations_campaign" ON "survey_invitations" ("campaignId")`,
    );
    // The public respond route looks an invitation up by token hash and
    // nothing else, so this index is on the hot path of the one unauthenticated
    // endpoint in the feature.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_survey_invitations_token_hash" ON "survey_invitations" ("tokenHash")`,
    );

    await ensureRlsHelperFunctions(queryRunner);

    for (const table of [
      'survey_templates',
      'survey_campaigns',
      'survey_invitations',
    ]) {
      for (const [name, clause] of [
        ['select', 'FOR SELECT\n  USING'],
        ['insert', 'FOR INSERT\n  WITH CHECK'],
        ['delete', 'FOR DELETE\n  USING'],
      ] as const) {
        await queryRunner.query(`
CREATE POLICY ${table}_${name} ON ${table}
  ${clause} (app_rls_bootstrap() OR "organisationId" = app_current_org())`);
      }

      await queryRunner.query(`
CREATE POLICY ${table}_update ON ${table}
  FOR UPDATE
  USING (app_rls_bootstrap() OR "organisationId" = app_current_org())
  WITH CHECK (app_rls_bootstrap() OR "organisationId" = app_current_org())`);

      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'survey_invitations',
      'survey_campaigns',
      'survey_templates',
    ]) {
      await queryRunner.query(
        `ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`,
      );
      for (const name of ['update', 'delete', 'insert', 'select']) {
        await queryRunner.query(
          `DROP POLICY IF EXISTS ${table}_${name} ON ${table}`,
        );
      }
    }

    await queryRunner.query(
      `DROP INDEX "public"."UQ_survey_invitations_token_hash"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_survey_invitations_campaign"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_survey_campaigns_org_closes"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_survey_templates_org"`);
    await queryRunner.query(`DROP TABLE "survey_invitations"`);
    await queryRunner.query(`DROP TABLE "survey_campaigns"`);
    await queryRunner.query(`DROP TABLE "survey_templates"`);
  }
}
