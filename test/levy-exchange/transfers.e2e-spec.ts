import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

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
  expectLevyTransferDocumentResource,
  expectLevyTransferResource,
} from '../helpers/levy-exchange-contracts.js';
import {
  applyTenantContext,
  createLexOrgContext,
  mockDasForLevyExchange,
  seedConfirmedMatch,
} from '../helpers/levy-exchange-e2e.js';
import { processPdfJobInApp } from '../helpers/process-pdf-job.js';

import type { App } from 'supertest/types';

describe('Levy Exchange transfers (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    noopStorageObjects.clear();
    mockDasForLevyExchange(app);
  });

  it('creates transfer, signs both parties, returns document, and submits to DAS', async () => {
    const donorCtx = await createLexOrgContext(app, 'transfers-donor');
    const recipientCtx = await createLexOrgContext(app, 'transfers-recipient');
    const { matchApplicationId } = await seedConfirmedMatch(
      app,
      donorCtx,
      recipientCtx,
    );

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/transfers')
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

    applyTenantContext(donorCtx);
    const documentRepo = app.get(getRepositoryToken(LevyTransferDocument));
    const document = await documentRepo.findOne({
      where: { transferId, isDeleted: false },
    });
    expect(document?.pdfJobId).toBeTruthy();

    await processPdfJobInApp(app, {
      jobId: document!.pdfJobId!,
      organisationId: donorCtx.orgId,
      userId: donorCtx.user.userId,
      template: PdfJobTemplate.LEVY_TRANSFER_AGREEMENT,
      transferId,
    });

    const donorSignatureKey = `orgs/${donorCtx.orgId}/${StorageObjectCategory.SIGNATURE}/donor/signature.png`;
    const recipientSignatureKey = `orgs/${recipientCtx.orgId}/${StorageObjectCategory.SIGNATURE}/recipient/signature.png`;
    noopStorageObjects.set(donorSignatureKey, Buffer.from('donor-signature'));
    noopStorageObjects.set(
      recipientSignatureKey,
      Buffer.from('recipient-signature'),
    );

    const donorSignRes = await request(app.getHttpServer())
      .post(`/api/v1/levy-exchange/transfers/${transferId}/sign`)
      .set(donorCtx.authHeaders)
      .send({
        party: LevyTransferParty.DONOR,
        signatureImageKey: donorSignatureKey,
      })
      .expect(201);
    expectSuccessEnvelope(donorSignRes.body);
    expect(
      (donorSignRes.body as { data: { nextParty: string | null } }).data
        .nextParty,
    ).toBe(LevyTransferParty.RECIPIENT);

    const recipientSignRes = await request(app.getHttpServer())
      .post(`/api/v1/levy-exchange/transfers/${transferId}/sign`)
      .set(recipientCtx.authHeaders)
      .send({
        party: LevyTransferParty.RECIPIENT,
        signatureImageKey: recipientSignatureKey,
      })
      .expect(201);
    expectSuccessEnvelope(recipientSignRes.body);
    expect(
      (recipientSignRes.body as { data: { status: string } }).data.status,
    ).toBe(LevyTransferStatus.PENDING_ESFA);

    const documentRes = await request(app.getHttpServer())
      .get(`/api/v1/levy-exchange/transfers/${transferId}/document`)
      .set(donorCtx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(documentRes.body);
    expectLevyTransferDocumentResource(
      (documentRes.body as { data: unknown }).data,
    );

    const submitRes = await request(app.getHttpServer())
      .post(`/api/v1/levy-exchange/transfers/${transferId}/submit`)
      .set(donorCtx.authHeaders)
      .expect(201);
    expectSuccessEnvelope(submitRes.body);
    expect(
      (submitRes.body as { data: { esfaTransferReference: string } }).data
        .esfaTransferReference,
    ).toBe('ESFA-TRANSFER-REF-1');

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/levy-exchange/transfers/${transferId}`)
      .set(donorCtx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(getRes.body);
    expect((getRes.body as { data: { status: string } }).data.status).toBe(
      LevyTransferStatus.CONFIRMED,
    );
  });

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

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/transfers')
      .set(donorCtx.authHeaders)
      .send({
        matchApplicationId,
        recipientSignerUserId: recipientCtx.user.userId,
      })
      .expect(201);

    const transferId = (createRes.body as { data: { id: string } }).data.id;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/levy-exchange/transfers/${transferId}/submit`)
      .set(recipientCtx.authHeaders)
      .expect(400);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 400,
      message: 'Only the donor organisation can submit to DAS',
      path: `/api/v1/levy-exchange/transfers/${transferId}/submit`,
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

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/transfers')
      .set(donorCtx.authHeaders)
      .send({
        matchApplicationId,
        recipientSignerUserId: recipientCtx.user.userId,
      })
      .expect(201);

    const transferId = (createRes.body as { data: { id: string } }).data.id;

    const res = await request(app.getHttpServer())
      .post(`/api/v1/levy-exchange/transfers/${transferId}/submit`)
      .set(donorCtx.authHeaders)
      .expect(409);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 409,
      message: 'Transfer must be fully signed before DAS submission',
      path: `/api/v1/levy-exchange/transfers/${transferId}/submit`,
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

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/levy-exchange/transfers')
      .set(donorCtx.authHeaders)
      .send({
        matchApplicationId,
        recipientSignerUserId: recipientCtx.user.userId,
      })
      .expect(201);
    const transferId = (createRes.body as { data: { id: string } }).data.id;

    const donorListRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/transfers?role=donor')
      .set(donorCtx.authHeaders)
      .expect(200);
    expectSuccessEnvelope(donorListRes.body);
    const donorRows = (donorListRes.body as { data: { id: string }[] }).data;
    expect(donorRows.some((r) => r.id === transferId)).toBe(true);

    const recipientListRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/transfers?role=recipient')
      .set(recipientCtx.authHeaders)
      .expect(200);
    const recipientRows = (recipientListRes.body as { data: { id: string }[] })
      .data;
    expect(recipientRows.some((r) => r.id === transferId)).toBe(true);

    const unrelatedCtx = await createLexOrgContext(
      app,
      'transfers-list-unrelated',
    );
    const unrelatedListRes = await request(app.getHttpServer())
      .get('/api/v1/levy-exchange/transfers')
      .set(unrelatedCtx.authHeaders)
      .expect(200);
    const unrelatedRows = (unrelatedListRes.body as { data: { id: string }[] })
      .data;
    expect(unrelatedRows.some((r) => r.id === transferId)).toBe(false);
  });

  it('returns 404 for missing transfer document', async () => {
    const donorCtx = await createLexOrgContext(app, 'transfers-doc-missing');
    const res = await request(app.getHttpServer())
      .get(
        '/api/v1/levy-exchange/transfers/00000000-0000-4000-8000-000000000001/document',
      )
      .set(donorCtx.authHeaders)
      .expect(404);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 404,
      message: /Levy transfer (not found|document not found)/,
      path: '/api/v1/levy-exchange/transfers/00000000-0000-4000-8000-000000000001/document',
      error: 'Not Found',
    });
  });
});
