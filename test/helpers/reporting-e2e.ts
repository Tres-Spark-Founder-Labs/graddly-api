import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';
import { PdfJobStatus } from '../../src/pdf/enums/pdf-job-status.enum.js';
import { PdfJobTemplate } from '../../src/pdf/enums/pdf-job-template.enum.js';

import { createVerifiedUser, type IVerifiedUserFixture } from './e2e-http.js';
import { buildOrgPayload } from './e2e-organisation.js';
import { processPdfJobInApp } from './process-pdf-job.js';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

export interface IEmployerReportingContext {
  owner: IVerifiedUserFixture;
  employerOrgId: string;
  providerOrgId: string;
  authHeaders: Record<string, string>;
  enrolmentId: string;
}

export interface IProviderDirectoryContext {
  owner: IVerifiedUserFixture;
  providerOrgId: string;
  employerOrgId: string;
  authHeaders: Record<string, string>;
  enrolmentId: string;
}

export interface IFlowSmeContext {
  owner: IVerifiedUserFixture;
  flowOrgId: string;
  providerOrgId: string;
  authHeaders: Record<string, string>;
  enrolmentId: string;
}

async function seedProgrammeGraph(
  app: INestApplication<App>,
  authHeaders: Record<string, string>,
  suffix: number,
) {
  const programmeRes = await request(app.getHttpServer())
    .post('/api/v1/programmes')
    .set(authHeaders)
    .send({
      code: `RPT-PROG-${suffix}`,
      title: 'Reporting Programme',
      status: 'active',
    })
    .expect(201);
  const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

  const standardRes = await request(app.getHttpServer())
    .post('/api/v1/standards')
    .set(authHeaders)
    .send({
      programmeId,
      code: `RPT-STD-${suffix}`,
      title: 'Reporting Standard',
      status: 'active',
    })
    .expect(201);
  const standardId = (standardRes.body as { data: { id: string } }).data.id;

  const apprenticeRes = await request(app.getHttpServer())
    .post('/api/v1/apprentices')
    .set(authHeaders)
    .send({
      firstName: 'Report',
      lastName: 'Apprentice',
      email: `rpt-apprentice-${suffix}@example.com`,
    })
    .expect(201);
  const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data.id;

  return { standardId, apprenticeId };
}

export async function createEmployerReportingContext(
  app: INestApplication<App>,
  label: string,
): Promise<IEmployerReportingContext> {
  const suffix = Date.now();
  const owner = await createVerifiedUser(app, {
    email: `rpt-employer-${label}-${suffix}@example.com`,
  });

  const providerRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      ...buildOrgPayload(`RPT Provider ${label} ${suffix}`),
      portalType: 'provider',
    })
    .expect(201);
  const providerOrgId = (providerRes.body as { data: { id: string } }).data.id;

  const employerRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      ...buildOrgPayload(`RPT Employer ${label} ${suffix}`),
      portalType: 'employer',
    })
    .expect(201);
  const employerOrgId = (employerRes.body as { data: { id: string } }).data.id;

  const authHeaders: Record<string, string> = {
    [ORGANISATION_ID_HEADER]: employerOrgId,
  };
  authHeaders['Authorization'] = `Bearer ${owner.accessToken}`;

  const { standardId, apprenticeId } = await seedProgrammeGraph(
    app,
    authHeaders,
    suffix,
  );

  const enrolmentRes = await request(app.getHttpServer())
    .post('/api/v1/enrolments')
    .set(authHeaders)
    .send({ apprenticeId, standardId, agreedPrice: 18000 })
    .expect(201);
  const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

  await request(app.getHttpServer())
    .patch(`/api/v1/enrolments/${enrolmentId}/organisation-links`)
    .set(authHeaders)
    .send({ providerOrganisationId: providerOrgId })
    .expect(200);

  await request(app.getHttpServer())
    .post(`/api/v1/enrolments/${enrolmentId}/activate`)
    .set(authHeaders)
    .expect(201);

  return {
    owner,
    employerOrgId,
    providerOrgId,
    authHeaders,
    enrolmentId,
  };
}

export async function createProviderDirectoryContext(
  app: INestApplication<App>,
  label: string,
): Promise<IProviderDirectoryContext> {
  const suffix = Date.now();
  const owner = await createVerifiedUser(app, {
    email: `rpt-provider-${label}-${suffix}@example.com`,
  });

  const providerRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      ...buildOrgPayload(`RPT Directory Provider ${label} ${suffix}`),
      portalType: 'provider',
      city: 'London',
    })
    .expect(201);
  const providerOrgId = (providerRes.body as { data: { id: string } }).data.id;

  const employerRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      ...buildOrgPayload(`RPT Directory Employer ${label} ${suffix}`),
      portalType: 'employer',
      city: 'London',
    })
    .expect(201);
  const employerOrgId = (employerRes.body as { data: { id: string } }).data.id;

  const authHeaders: Record<string, string> = {
    [ORGANISATION_ID_HEADER]: providerOrgId,
  };
  authHeaders['Authorization'] = `Bearer ${owner.accessToken}`;

  const { standardId, apprenticeId } = await seedProgrammeGraph(
    app,
    authHeaders,
    suffix,
  );

  const enrolmentRes = await request(app.getHttpServer())
    .post('/api/v1/enrolments')
    .set(authHeaders)
    .send({ apprenticeId, standardId, agreedPrice: 15000 })
    .expect(201);
  const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

  await request(app.getHttpServer())
    .patch(`/api/v1/enrolments/${enrolmentId}/organisation-links`)
    .set(authHeaders)
    .send({ employerOrganisationId: employerOrgId })
    .expect(200);

  await request(app.getHttpServer())
    .post(`/api/v1/enrolments/${enrolmentId}/activate`)
    .set(authHeaders)
    .expect(201);

  return {
    owner,
    providerOrgId,
    employerOrgId,
    authHeaders,
    enrolmentId,
  };
}

export async function createFlowSmeContext(
  app: INestApplication<App>,
  label: string,
): Promise<IFlowSmeContext> {
  const suffix = Date.now();
  const owner = await createVerifiedUser(app, {
    email: `rpt-flow-${label}-${suffix}@example.com`,
  });

  const providerRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      ...buildOrgPayload(`RPT Flow Provider ${label} ${suffix}`),
      portalType: 'provider',
    })
    .expect(201);
  const providerOrgId = (providerRes.body as { data: { id: string } }).data.id;

  const flowRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      ...buildOrgPayload(`RPT Flow SME ${label} ${suffix}`),
      portalType: 'flow',
    })
    .expect(201);
  const flowOrgId = (flowRes.body as { data: { id: string } }).data.id;

  const authHeaders: Record<string, string> = {
    [ORGANISATION_ID_HEADER]: flowOrgId,
  };
  authHeaders['Authorization'] = `Bearer ${owner.accessToken}`;

  const { standardId, apprenticeId } = await seedProgrammeGraph(
    app,
    authHeaders,
    suffix,
  );

  const enrolmentRes = await request(app.getHttpServer())
    .post('/api/v1/enrolments')
    .set(authHeaders)
    .send({ apprenticeId, standardId, agreedPrice: 16000 })
    .expect(201);
  const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

  await request(app.getHttpServer())
    .patch(`/api/v1/enrolments/${enrolmentId}/organisation-links`)
    .set(authHeaders)
    .send({ providerOrganisationId: providerOrgId })
    .expect(200);

  await request(app.getHttpServer())
    .post(`/api/v1/enrolments/${enrolmentId}/activate`)
    .set(authHeaders)
    .expect(201);

  return {
    owner,
    flowOrgId,
    providerOrgId,
    authHeaders,
    enrolmentId,
  };
}

export { PdfJobStatus, PdfJobTemplate, processPdfJobInApp };
