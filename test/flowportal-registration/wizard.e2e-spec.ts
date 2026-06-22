import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { EmailDispatchService } from '../../src/email/email-dispatch.service.js';
import { EmailTemplate } from '../../src/email/email-template.enum.js';
import { RegistrationWizardStep } from '../../src/flowportal-registration/enums/registration-wizard-step.enum.js';
import { expectSuccessEnvelope } from '../helpers/e2e-response-contracts.js';

import type { App } from 'supertest/types';

describe('Flowportal registration wizard (e2e)', () => {
  let app: INestApplication<App>;
  let emailEnqueueSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const emailDispatch = app.get(EmailDispatchService);
    emailEnqueueSpy = jest.spyOn(emailDispatch, 'enqueue').mockResolvedValue();
  });

  afterAll(async () => {
    emailEnqueueSpy.mockRestore();
    await app.close();
  });

  it('runs full 5-step wizard, resumes by token, and enqueues confirmation email', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/flowportal-registration/sessions')
      .send({
        contactEmail: 'wizard-e2e@example.com',
        sector: 'construction',
        region: 'north_west',
      })
      .expect(201);

    expectSuccessEnvelope(createRes.body);
    const resumeToken = createRes.body.data.resumeToken as string;
    expect(resumeToken).toBeDefined();

    const resumeRes = await request(app.getHttpServer())
      .get(`/api/v1/flowportal-registration/sessions/by-token/${resumeToken}`)
      .expect(200);

    expect(resumeRes.body.data.currentStep).toBe(
      RegistrationWizardStep.COMPANY_VERIFICATION,
    );

    await request(app.getHttpServer())
      .put(
        `/api/v1/flowportal-registration/sessions/by-token/${resumeToken}/steps/${RegistrationWizardStep.COMPANY_VERIFICATION}`,
      )
      .send({ companiesHouseNumber: '12345678' })
      .expect(200);

    await request(app.getHttpServer())
      .put(
        `/api/v1/flowportal-registration/sessions/by-token/${resumeToken}/steps/${RegistrationWizardStep.PAYE_REFERENCE}`,
      )
      .send({ payeReference: '123/AB45678' })
      .expect(200);

    await request(app.getHttpServer())
      .put(
        `/api/v1/flowportal-registration/sessions/by-token/${resumeToken}/steps/${RegistrationWizardStep.DAS_ACCOUNT}`,
      )
      .send({ hasDasAccount: false, dasAccountCreated: false })
      .expect(200);

    await request(app.getHttpServer())
      .put(
        `/api/v1/flowportal-registration/sessions/by-token/${resumeToken}/steps/${RegistrationWizardStep.BANK_DETAILS}`,
      )
      .send({
        accountName: 'Wizard E2E Ltd',
        sortCode: '12-34-56',
        accountNumber: '12345678',
      })
      .expect(200);

    await request(app.getHttpServer())
      .put(
        `/api/v1/flowportal-registration/sessions/by-token/${resumeToken}/steps/${RegistrationWizardStep.CONSENT}`,
      )
      .send({
        levyTransferConsent: true,
        dataProcessingConsent: true,
        signatoryName: 'Jane Smith',
        contactEmail: 'wizard-e2e@example.com',
      })
      .expect(200);

    const completeRes = await request(app.getHttpServer())
      .post(
        `/api/v1/flowportal-registration/sessions/by-token/${resumeToken}/complete`,
      )
      .expect(201);

    expect(completeRes.body.data.status).toBe('completed');
    expect(emailEnqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        template: EmailTemplate.FLOWPORTAL_REGISTRATION_COMPLETE,
        to: 'wizard-e2e@example.com',
      }),
    );
  });
});
