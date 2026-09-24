import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { authenticator } from 'otplib';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/configure-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { createE2ePgClient } from './helpers/rls-db.js';

import type { Client } from 'pg';

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

  /**
   * 6.4 — "MFA changes appear with the acting user".
   *
   * Asserted against the table, not against a mock. The unit spec proves the
   * service calls `save()` and `record()` correctly; only a real request can
   * show that a row lands, that `actorUserId` is the person who acted, and
   * that the secret and the recovery codes are not in it.
   *
   * That last assertion is the one this whole batch turns on:
   * `audit_log_entries` is append-only by trigger and kept for seven years,
   * so a credential that reaches `changes` once cannot be taken out again.
   */
  describe('Audit trail (6.4)', () => {
    let sudo: Client;

    beforeAll(async () => {
      sudo = createE2ePgClient();
      await sudo.connect();
    });

    afterAll(async () => {
      await sudo?.end();
    });

    it('records enrolment, activation and deactivation against the acting user, with no credential in any payload', async () => {
      const user = await createVerifiedUser(app);
      const { secret } = await enrollAndConfirm(user.accessToken);

      await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/disable')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ code: authenticator.generate(secret) })
        .expect(204);

      const rows = await sudo.query<{
        action: string;
        description: string;
        actorUserId: string | null;
        organisationId: string | null;
        changes: Record<string, { from?: unknown; to?: unknown }>;
      }>(
        `SELECT action, description, "actorUserId", "organisationId", changes
           FROM audit_log_entries
          WHERE "entityType" = 'users' AND "entityId" = $1
          ORDER BY "createdAt"`,
        [user.userId],
      );

      expect(rows.rows.length).toBeGreaterThanOrEqual(3);

      // The enrolment start: an event, because the secret is the only column
      // that moved and it must never be recorded.
      const enrolment = rows.rows.find((row) =>
        row.description.includes('enrolment started'),
      );
      expect(enrolment).toBeDefined();
      expect(enrolment?.changes).toEqual({});
      /**
       * Null, deliberately: this user belongs to no organisation, and the
       * `users` branch of the resolver files an account event at the platform
       * level rather than inside an organisation the person has not joined.
       * Readable under `app_rls_bootstrap()`, not through the tenant export.
       */
      expect(enrolment?.organisationId).toBeNull();

      // Activation and deactivation reach the subscriber, because `mfaEnabled`
      // is an ordinary column and safe to record.
      // Scoped to updates: the signup insert also carries
      // `mfaEnabled: { to: false }`, being the initial value of the column.
      const enabled = rows.rows.find(
        (row) => row.action === 'update' && row.changes.mfaEnabled?.to === true,
      );
      const disabled = rows.rows.find(
        (row) =>
          row.action === 'update' && row.changes.mfaEnabled?.to === false,
      );
      expect(enabled?.changes.mfaEnabled).toEqual({ from: false, to: true });
      expect(disabled?.changes.mfaEnabled).toEqual({ from: true, to: false });

      /**
       * The done-when: each of the three MFA changes names the person who
       * made it. Asserted on those three rows and not on every `users` row,
       * because the rest of this user's trail honestly has no actor — the
       * signup insert happens before anyone is signed in, and the email
       * verification arrives on a token rather than a session. A null there
       * is the truth; claiming the subject acted would be a guess.
       */
      for (const row of [enrolment, enabled, disabled]) {
        expect(row?.actorUserId).toBe(user.userId);
      }
      const signup = rows.rows.find((row) => row.action === 'insert');
      expect(signup?.actorUserId).toBeNull();

      // And nothing anywhere in the trail carries the credential.
      const payloads = JSON.stringify(rows.rows);
      expect(payloads).not.toContain(secret);
      expect(payloads).not.toMatch(/\$2[aby]\$\d{2}\$/);
      for (const field of ['mfaSecret', 'mfaRecoveryCodes', 'password']) {
        expect(rows.rows.some((row) => field in row.changes)).toBe(false);
      }
    });
  });
});
