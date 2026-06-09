import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { configureHelmet } from '../../src/configure-helmet.js';
import { PLATFORM_OPS_API_KEY_HEADER } from '../../src/platform-gdpr/platform-gdpr.constants.js';
import { verifyUserEmail } from '../helpers/e2e-http.js';
import {
  expectFilteredHttpExceptionBody,
  expectSuccessEnvelope,
} from '../helpers/e2e-response-contracts.js';
import {
  applyPlatformOpsE2eEnv,
  disablePlatformOpsE2eEnv,
  E2E_PLATFORM_OPS_API_KEY,
} from '../helpers/platform-ops-e2e-env.js';
import { getUserIdByEmail } from '../helpers/rls-db.js';

function opsAuthHeaders(
  apiKey: string = E2E_PLATFORM_OPS_API_KEY,
): Record<string, string> {
  return { [PLATFORM_OPS_API_KEY_HEADER]: apiKey };
}

describe('Platform GDPR erasure (e2e)', () => {
  let app: INestApplication<App>;

  const signupDto = {
    firstName: 'Erasure',
    lastName: 'Subject',
    email: `erasure-e2e-${Date.now()}@example.com`,
    password: 'P@ssw0rd!',
  };

  let userId: string;

  beforeAll(async () => {
    applyPlatformOpsE2eEnv();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHelmet(app);
    configureApp(app);
    await app.init();

    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send(signupDto)
      .expect(201);

    await verifyUserEmail(app, signupDto.email);
    userId = await getUserIdByEmail(signupDto.email);
  });

  afterAll(async () => {
    await app.close();
    disablePlatformOpsE2eEnv();
  });

  it('returns 401 without platform ops API key', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/platform/gdpr/erasure')
      .send({ subjectType: 'user', subjectId: userId })
      .expect(401);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 401,
      message: 'Invalid platform ops API key',
      path: '/api/v1/platform/gdpr/erasure',
      error: 'Unauthorized',
    });
  });

  it('anonymises user and blocks subsequent login', async () => {
    const eraseRes = await request(app.getHttpServer())
      .post('/api/v1/platform/gdpr/erasure')
      .set(opsAuthHeaders())
      .send({
        subjectType: 'user',
        subjectId: userId,
        reason: 'e2e test',
      })
      .expect(200);

    expectSuccessEnvelope(eraseRes.body as Record<string, unknown>);
    expect(eraseRes.body.data).toEqual(
      expect.objectContaining({
        subjectType: 'user',
        subjectId: userId,
        alreadyErased: false,
      }),
    );

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: signupDto.email, password: signupDto.password })
      .expect(401);

    expectFilteredHttpExceptionBody(loginRes.body as Record<string, unknown>, {
      statusCode: 401,
      message: 'Invalid credentials',
      path: '/api/v1/auth/login',
      error: 'Unauthorized',
    });
  });
});
