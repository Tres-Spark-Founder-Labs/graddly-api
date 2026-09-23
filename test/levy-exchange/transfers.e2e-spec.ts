import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';
import { DAS_CLIENT } from '../../src/das/das-client.constants.js';
import { LevyTransferDocument } from '../../src/levy-exchange/entities/levy-transfer-document.entity.js';
import { LevyTransferParty } from '../../src/levy-exchange/enums/levy-transfer-party.enum.js';
import { LevyTransferStatus } from '../../src/levy-exchange/enums/levy-transfer-status.enum.js';
import { PdfJobTemplate } from '../../src/pdf/enums/pdf-job-template.enum.js';
import { StorageObjectCategory } from '../../src/storage/enums/storage-object-category.enum.js';
import { noopStorageObjects } from '../../src/storage/providers/noop-storage.store.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectSuccessEnvelope,
} from '../helpers/e2e-response-contracts.js';
import {
  createLearnerScopeContext,
  type ILearnerScopeContext,
} from '../helpers/learner-scope-e2e.js';
import {
  expectLevyTransferDocumentResource,
  expectLevyTransferResource,
} from '../helpers/levy-exchange-contracts.js';
import {
  applyTenantContext,
  createLexOrgContext,
  mockDasForLevyExchange,
  seedConfirmedMatch,
  type ILexOrgContext,
} from '../helpers/levy-exchange-e2e.js';
import { processPdfJobInApp } from '../helpers/process-pdf-job.js';

import type { App } from 'supertest/types';

/** Computed key: a literal `Authorization:` trips the naming-convention rule. */
const AUTH_HEADER = 'Authorization';
const BASE = '/api/v1/levy-exchange/transfers';

/**
 * Levy transfers (F4.2.4), run under enforced row-level security.
 *
 * ── WHAT THIS SUITE USED TO PROVE, AND WHY IT WAS WRONG ─────────────────────
 *
 * It passed a recipient's signature because rls-bootstrap.middleware.ts turned
 * RLS off for every POST under /levy-exchange/transfers — not because any
 * policy admitted the recipient. It would have stayed green if the service's
 * where clauses regressed, and it never asked whether the recipient could open
 * its own agreement (it could not: 404 at every stage).
 *
 * ── HOW IT KEEPS ITSELF HONEST NOW ──────────────────────────────────────────
 *
 *   1. The app's own database role is asserted to be neither superuser nor
 *      BYPASSRLS, from inside the suite, rather than trusted by name.
 *   2. There is no process-global tenant state for a request to inherit. The
 *      harness (`applyTenantContext`) enters a store on the test's own async
 *      chain, and each request gets its own from CorrelationIdMiddleware. A
 *      query that lost its request context now sends '' and sees nothing,
 *      rather than running as whichever organisation was set last — a pass
 *      for the wrong reason, the very failure this suite had. `http()` is
 *      kept as the one way to send a request so that stays the case.
 *   3. The DAS consent is mocked on whichever client the app resolved, so
 *      submit is exercised in manual mode too.
 */
describe('Levy Exchange transfers (e2e)', () => {
  let app: INestApplication<App>;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    noopStorageObjects.clear();
    mockDasForLevyExchange(app);
    const resolved = app.get<{
      createLevyTransferConsent: (...args: unknown[]) => Promise<unknown>;
    }>(DAS_CLIENT);
    jest.spyOn(resolved, 'createLevyTransferConsent').mockResolvedValue({
      reference: 'ESFA-TRANSFER-REF-1',
      status: 'confirmed',
      raw: { status: 'confirmed', reference: 'ESFA-TRANSFER-REF-1' },
    });
  });

  /** The learner-scope employer, as a Levy Exchange party. */
  const recipientFromScope = (scope: ILearnerScopeContext): ILexOrgContext => {
    const authorization = scope.staffHeaders[AUTH_HEADER];
    const accessToken = authorization.replace(/^Bearer /, '');
    return {
      user: {
        userId: scope.staffUserId,
        email: '',
        password: '',
        accessToken,
        refreshToken: '',
      },
      orgName: `scope employer ${scope.employerOrgId}`,
      orgId: scope.employerOrgId,
      accessToken,
      authHeaders: {
        [AUTH_HEADER]: authorization,
        [ORGANISATION_ID_HEADER]: scope.employerOrgId,
      },
    };
  };

  const detail = async (ctx: ILexOrgContext, transferId: string) => {
    const res = await http()
      .get(`${BASE}/${transferId}`)
      .set(ctx.authHeaders)
      .expect(200);
    return (res.body as { data: Record<string, unknown> }).data;
  };

  const documentFor = (ctx: ILexOrgContext, transferId: string) =>
    http().get(`${BASE}/${transferId}/document`).set(ctx.authHeaders);

  const signAs = (
    ctx: ILexOrgContext,
    transferId: string,
    party: LevyTransferParty,
    signatureImageKey: string,
  ) =>
    http()
      .post(`${BASE}/${transferId}/sign`)
      .set(ctx.authHeaders)
      .send({ party, signatureImageKey });

  /** The storage key a noop presigned URL points at. */
  const keyOf = (downloadUrl: unknown) =>
    decodeURIComponent(String(downloadUrl));

  /**
   * Checked, not trusted by name: a role with BYPASSRLS, or a superuser, would
   * pass every test below with the policies doing nothing.
   */
  it('runs as a database role that cannot bypass row-level security', async () => {
    const [role] = await app
      .get(DataSource)
      .query(
        'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
    expect(role).toEqual({
      rolname: expect.any(String) as string,
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  it('runs the whole transfer under RLS, for both parties', async () => {
    const donorCtx = await createLexOrgContext(app, 'transfers-donor');
    const scope = await createLearnerScopeContext(app, 'transfers');
    try {
      const recipientCtx = recipientFromScope(scope);
      // buildOrgPayload gives every org a UKPRN, which the ESFA consent needs.
      const { matchApplicationId } = await seedConfirmedMatch(
        app,
        donorCtx,
        recipientCtx,
      );

      // ── create: the donor inserts the recipient's signature slot ────────────
      const createRes = await http()
        .post(BASE)
        .set(donorCtx.authHeaders)
        .send({
          matchApplicationId,
          recipientSignerUserId: recipientCtx.user.userId,
          startDate: '2026-04-01',
        })
        .expect(201);
      expectSuccessEnvelope(createRes.body);
      expectLevyTransferResource((createRes.body as { data: unknown }).data);
      const transferId = (createRes.body as { data: { id: string } }).data.id;

      // Harness only: generate the agreement PDF as the donor's job would.
      applyTenantContext(donorCtx);
      const document = await app
        .get(getRepositoryToken(LevyTransferDocument))
        .findOne({ where: { transferId, isDeleted: false } });
      await processPdfJobInApp(app, {
        jobId: (document as LevyTransferDocument).pdfJobId!,
        organisationId: donorCtx.orgId,
        userId: donorCtx.user.userId,
        template: PdfJobTemplate.LEVY_TRANSFER_AGREEMENT,
        transferId,
      });

      // ── before either signature, the recipient can open the agreement ──────
      const unsigned = await documentFor(recipientCtx, transferId).expect(200);
      expectLevyTransferDocumentResource(
        (unsigned.body as { data: unknown }).data,
      );
      const unsignedData = (
        unsigned.body as { data: { status: string; downloadUrl?: string } }
      ).data;
      expect(unsignedData.status).toBe('ready');
      expect(keyOf(unsignedData.downloadUrl)).toContain(
        `orgs/${donorCtx.orgId}/`,
      );

      // ── the signal, not the status: pending_signatures is true for both ────
      expect(await detail(donorCtx, transferId)).toMatchObject({
        status: LevyTransferStatus.PENDING_SIGNATURES,
        nextParty: LevyTransferParty.DONOR,
        actionRequired: true,
      });
      expect(await detail(recipientCtx, transferId)).toMatchObject({
        status: LevyTransferStatus.PENDING_SIGNATURES,
        nextParty: LevyTransferParty.DONOR,
        actionRequired: false,
        // Who the transfer is from. organisations_select admits members only,
        // so under graddly_app this arrives only through the service's
        // label-only bootstrap read.
        donorOrganisationName: donorCtx.orgName,
      });

      const donorKey = `orgs/${donorCtx.orgId}/${StorageObjectCategory.SIGNATURE}/donor/signature.png`;
      const recipientKey = `orgs/${recipientCtx.orgId}/${StorageObjectCategory.SIGNATURE}/recipient/signature.png`;
      noopStorageObjects.set(donorKey, Buffer.from('donor-signature'));
      noopStorageObjects.set(recipientKey, Buffer.from('recipient-signature'));

      // ── the order is enforced by the API, with the slots both parties see ──
      const early = await signAs(
        recipientCtx,
        transferId,
        LevyTransferParty.RECIPIENT,
        recipientKey,
      ).expect(409);
      expect((early.body as { message: string }).message).toBe(
        'Next signer is donor, not recipient',
      );

      const donorSign = await signAs(
        donorCtx,
        transferId,
        LevyTransferParty.DONOR,
        donorKey,
      ).expect(201);
      expect(
        (donorSign.body as { data: { nextParty: string | null } }).data
          .nextParty,
      ).toBe(LevyTransferParty.RECIPIENT);

      expect(await detail(recipientCtx, transferId)).toMatchObject({
        nextParty: LevyTransferParty.RECIPIENT,
        actionRequired: true,
      });
      expect((await detail(donorCtx, transferId)).actionRequired).toBe(false);
      await documentFor(recipientCtx, transferId).expect(200);

      const recipientSign = await signAs(
        recipientCtx,
        transferId,
        LevyTransferParty.RECIPIENT,
        recipientKey,
      ).expect(201);
      expect(
        (recipientSign.body as { data: { status: string } }).data.status,
      ).toBe(LevyTransferStatus.PENDING_ESFA);

      // ── F4.2.4 AC3: a lasting copy in each party's own storage ─────────────
      for (const ctx of [donorCtx, recipientCtx]) {
        const res = await documentFor(ctx, transferId).expect(200);
        const data = (
          res.body as { data: { status: string; downloadUrl?: string } }
        ).data;
        expect(data.status).toBe('signed');
        expect(keyOf(data.downloadUrl)).toContain(`orgs/${ctx.orgId}/`);
        expect(keyOf(data.downloadUrl)).toContain(
          `levy-transfer-signed-${transferId}.pdf`,
        );
      }
      const signedState = await detail(recipientCtx, transferId);
      expect(signedState).toMatchObject({
        nextParty: null,
        actionRequired: false,
      });
      expect(signedState.signatures).toEqual([
        expect.objectContaining({ party: 'donor', signed: true }),
        expect.objectContaining({ party: 'recipient', signed: true }),
      ]);

      // ── submit: the recipient's UKPRN arrives through a narrow window ──────
      const submitRes = await http()
        .post(`${BASE}/${transferId}/submit`)
        .set(donorCtx.authHeaders)
        .expect(201);
      expect(
        (submitRes.body as { data: { esfaTransferReference: string } }).data
          .esfaTransferReference,
      ).toBe('ESFA-TRANSFER-REF-1');
      expect((await detail(donorCtx, transferId)).status).toBe(
        LevyTransferStatus.CONFIRMED,
      );

      // ── the enrolment link: only the enrolment's owner may attach it ───────
      const link = (headers: Record<string, string>) =>
        http()
          .post(`${BASE}/${transferId}/enrolments`)
          .set(headers)
          .send({ enrolmentId: scope.learnerA.enrolmentId });

      for (const outsider of [donorCtx.authHeaders, recipientCtx.authHeaders]) {
        const refused = await link(outsider).expect(404);
        expect((refused.body as { message: string }).message).toBe(
          'Enrolment not found',
        );
      }
      const linked = await link(scope.staffHeaders).expect(201);
      const again = await link(scope.staffHeaders).expect(201);
      const linkId = (linked.body as { data: { id: string } }).data.id;
      expect((again.body as { data: { id: string } }).data.id).toBe(linkId);

      // ── unlink: the donor and the recipient can SEE the link, and only the
      //    enrolment's owner can remove it. Under RLS their refused UPDATE
      //    affects no rows and save() does not say so, so this measures the
      //    read-back — the route used to answer them with success. ──────────
      const linkedIds = async (headers: Record<string, string>) =>
        (
          (
            await http()
              .get(`${BASE}/${transferId}/enrolments`)
              .set(headers)
              .expect(200)
          ).body as { data: { id: string }[] }
        ).data.map((row) => row.id);
      const unlink = (headers: Record<string, string>) =>
        http()
          .delete(
            `${BASE}/${transferId}/enrolments/${scope.learnerA.enrolmentId}`,
          )
          .set(headers);

      for (const outsider of [donorCtx.authHeaders, recipientCtx.authHeaders]) {
        expect(await linkedIds(outsider)).toEqual([linkId]);
        const refused = await unlink(outsider).expect(403);
        expect((refused.body as { message: string }).message).toBe(
          'Only the organisation that owns the enrolment can unlink it',
        );
        expect(await linkedIds(outsider)).toEqual([linkId]);
      }
      await unlink(scope.staffHeaders).expect(200);
      expect(await linkedIds(scope.staffHeaders)).toEqual([]);

      // ── and nobody else reaches any of it ──────────────────────────────────
      const stranger = await createLexOrgContext(app, 'transfers-stranger');
      await http()
        .get(`${BASE}/${transferId}`)
        .set(stranger.authHeaders)
        .expect(404);
      await documentFor(stranger, transferId).expect(404);
      await signAs(
        stranger,
        transferId,
        LevyTransferParty.RECIPIENT,
        recipientKey,
      ).expect(404);
      await http()
        .post(`${BASE}/${transferId}/submit`)
        .set(stranger.authHeaders)
        .expect(404);
    } finally {
      await scope.sudo.end();
    }
  }, 600_000);

  it('rejects DAS submit from recipient organisation', async () => {
    const donorCtx = await createLexOrgContext(app, 'transfers-submit-donor');
    const recipientCtx = await createLexOrgContext(
      app,
      'transfers-submit-recipient',
    );
    const { matchApplicationId } = await seedConfirmedMatch(
      app,
      donorCtx,
      recipientCtx,
    );

    const createRes = await http()
      .post(BASE)
      .set(donorCtx.authHeaders)
      .send({
        matchApplicationId,
        recipientSignerUserId: recipientCtx.user.userId,
      })
      .expect(201);
    const transferId = (createRes.body as { data: { id: string } }).data.id;

    const res = await http()
      .post(`${BASE}/${transferId}/submit`)
      .set(recipientCtx.authHeaders)
      .expect(400);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 400,
      message: 'Only the donor organisation can submit to DAS',
      path: `${BASE}/${transferId}/submit`,
      error: 'Bad Request',
    });
  });

  it('rejects submit before both parties sign', async () => {
    const donorCtx = await createLexOrgContext(app, 'transfers-unsigned-donor');
    const recipientCtx = await createLexOrgContext(
      app,
      'transfers-unsigned-recipient',
    );
    const { matchApplicationId } = await seedConfirmedMatch(
      app,
      donorCtx,
      recipientCtx,
    );

    const createRes = await http()
      .post(BASE)
      .set(donorCtx.authHeaders)
      .send({
        matchApplicationId,
        recipientSignerUserId: recipientCtx.user.userId,
      })
      .expect(201);
    const transferId = (createRes.body as { data: { id: string } }).data.id;

    const res = await http()
      .post(`${BASE}/${transferId}/submit`)
      .set(donorCtx.authHeaders)
      .expect(409);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 409,
      message: 'Transfer must be fully signed before DAS submission',
      path: `${BASE}/${transferId}/submit`,
      error: 'Conflict',
    });
  });

  it('lists transfers scoped to donor or recipient role', async () => {
    const donorCtx = await createLexOrgContext(app, 'transfers-list-donor');
    const recipientCtx = await createLexOrgContext(
      app,
      'transfers-list-recipient',
    );
    const { matchApplicationId } = await seedConfirmedMatch(
      app,
      donorCtx,
      recipientCtx,
    );

    const createRes = await http()
      .post(BASE)
      .set(donorCtx.authHeaders)
      .send({
        matchApplicationId,
        recipientSignerUserId: recipientCtx.user.userId,
      })
      .expect(201);
    const transferId = (createRes.body as { data: { id: string } }).data.id;

    const rowsFor = async (ctx: ILexOrgContext, query: string) => {
      const res = await http()
        .get(`${BASE}${query}`)
        .set(ctx.authHeaders)
        .expect(200);
      expectSuccessEnvelope(res.body);
      return (res.body as { data: { id: string; signatures: unknown[] }[] })
        .data;
    };

    const donorRows = await rowsFor(donorCtx, '?role=donor');
    expect(donorRows.some((r) => r.id === transferId)).toBe(true);
    // Both slots, read under RLS: the donor sees the recipient's slot too.
    expect(donorRows.find((r) => r.id === transferId)?.signatures).toHaveLength(
      2,
    );

    const recipientRows = await rowsFor(recipientCtx, '?role=recipient');
    expect(
      recipientRows.find((r) => r.id === transferId)?.signatures,
    ).toHaveLength(2);

    const unrelated = await createLexOrgContext(
      app,
      'transfers-list-unrelated',
    );
    expect(
      (await rowsFor(unrelated, '')).some((r) => r.id === transferId),
    ).toBe(false);
  });

  it('returns 404 for missing transfer document', async () => {
    const donorCtx = await createLexOrgContext(app, 'transfers-doc-missing');
    const res = await documentFor(
      donorCtx,
      '00000000-0000-4000-8000-000000000001',
    ).expect(404);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 404,
      message: /Levy transfer (not found|document not found)/,
      path: `${BASE}/00000000-0000-4000-8000-000000000001/document`,
      error: 'Not Found',
    });
  });
});
