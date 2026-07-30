import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { authenticator } from 'otplib';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/configure-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';

describe('MFA (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function enrollAndConfirm(accessToken: string) {
    const enrollRes = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/enroll')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const { secret } = enrollRes.body.data as { secret: string };
    const code = authenticator.generate(secret);

    const confirmRes = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/confirm')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ code })
      .expect(200);

    const { recoveryCodes } = confirmRes.body.data as {
      recoveryCodes: string[];
    };

    return { secret, recoveryCodes };
  }

  describe('Enrollment', () => {
    it('rejects enroll/confirm/disable without an access token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/enroll')
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/confirm')
        .send({ code: '123456' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/disable')
        .send({ code: '123456' })
        .expect(401);
    });

    it('starts enrollment and returns a secret + otpauth URL', async () => {
      const user = await createVerifiedUser(app);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.data.secret).toEqual(expect.any(String));
      expect(res.body.data.otpauthUrl).toContain('otpauth://totp/');
    });

    it('rejects confirmation with an invalid code', async () => {
      const user = await createVerifiedUser(app);

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/enroll')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/confirm')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ code: '000000' })
        .expect(401);
    });

    it('confirms enrollment with a valid code and returns 8 recovery codes', async () => {
      const user = await createVerifiedUser(app);
      const { recoveryCodes } = await enrollAndConfirm(user.accessToken);

      expect(recoveryCodes).toHaveLength(8);
      expect(new Set(recoveryCodes).size).toBe(8);
    });
  });

  describe('Login with MFA enabled', () => {
    it('returns a challenge instead of tokens, then completes with a valid TOTP code', async () => {
      const user = await createVerifiedUser(app);
      const { secret } = await enrollAndConfirm(user.accessToken);

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      expect(loginRes.body.data.mfaRequired).toBe(true);
      const { challengeToken } = loginRes.body.data as {
        challengeToken: string;
      };
      expect(challengeToken).toEqual(expect.any(String));

      const code = authenticator.generate(secret);
      const verifyRes = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken, code })
        .expect(200);

      expect(verifyRes.body.data.accessToken).toEqual(expect.any(String));
      expect(verifyRes.body.data.refreshToken).toEqual(expect.any(String));
    });

    it('rejects an invalid code and does not consume the challenge', async () => {
      const user = await createVerifiedUser(app);
      await enrollAndConfirm(user.accessToken);

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      const { challengeToken } = loginRes.body.data as {
        challengeToken: string;
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken, code: '000000' })
        .expect(401);
    });

    it('rejects reuse of an already-consumed challenge token', async () => {
      const user = await createVerifiedUser(app);
      const { secret } = await enrollAndConfirm(user.accessToken);

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      const { challengeToken } = loginRes.body.data as {
        challengeToken: string;
      };
      const code = authenticator.generate(secret);

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken, code })
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken, code })
        .expect(401);
    });

    it('rejects an unknown challenge token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({
          challengeToken: '550e8400-e29b-41d4-a716-446655440000',
          code: '123456',
        })
        .expect(401);
    });

    it('completes login with a recovery code, consuming it (single use)', async () => {
      const user = await createVerifiedUser(app);
      const { recoveryCodes } = await enrollAndConfirm(user.accessToken);
      const recoveryCode = recoveryCodes[0];

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      const { challengeToken } = loginRes.body.data as {
        challengeToken: string;
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken, recoveryCode })
        .expect(200);

      const loginRes2 = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      const { challengeToken: challengeToken2 } = loginRes2.body.data as {
        challengeToken: string;
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: challengeToken2, recoveryCode })
        .expect(401);
    });
  });

  describe('Disable MFA', () => {
    it('rejects disabling with an invalid code', async () => {
      const user = await createVerifiedUser(app);
      await enrollAndConfirm(user.accessToken);

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/disable')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ code: '000000' })
        .expect(401);
    });

    it('disables MFA with a valid code, and login no longer requires a challenge', async () => {
      const user = await createVerifiedUser(app);
      const { secret } = await enrollAndConfirm(user.accessToken);
      const code = authenticator.generate(secret);

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/disable')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ code })
        .expect(204);

      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      expect(loginRes.body.data.accessToken).toEqual(expect.any(String));
      expect(loginRes.body.data.mfaRequired).toBeUndefined();
    });
  });
});
