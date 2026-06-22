/* eslint-disable @typescript-eslint/naming-convention -- fixtures mirror process.env */

import { parseEnv } from './validate-env.js';

describe('parseEnv', () => {
  it('accepts a minimal development-shaped env', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      JWT_SECRET: 'change-me-in-production',
    });

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.THROTTLE_ENABLED).toBe(true);
    expect(env.TENANT_DB_CONTEXT_ENABLED).toBe(true);
    expect(env.OIDC_ENABLED).toBe(false);
    expect(env.EMAIL_PROVIDER).toBe('noop');
    expect(env.BULLMQ_PREFIX).toBe('graddly');
    expect(env.CRON_ENABLED).toBe(true);
    expect(env.CRON_HEALTH_SCHEDULE).toBe('*/5 * * * *');
    expect(env.CRON_LOCK_ENABLED).toBe(true);
    expect(env.CRON_LOCK_TTL_SECONDS).toBe(240);
    expect(env.QUEUE_OPS_ENABLED).toBe(false);
    expect(env.QUEUE_OPS_API_KEY).toBe('');
    expect(env.CRON_DAS_SYNC_ENABLED).toBe(false);
    expect(env.CRON_RETENTION_ENABLED).toBe(false);
    expect(env.CRON_DIGEST_ENABLED).toBe(false);
  });

  it('accepts OIDC disabled without client credentials', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      JWT_SECRET: 'change-me-in-production',
      OIDC_ENABLED: 'false',
    });

    expect(env.OIDC_ENABLED).toBe(false);
  });

  it('requires OIDC fields when OIDC is enabled', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'development',
        JWT_SECRET: 'change-me-in-production',
        OIDC_ENABLED: 'true',
      }),
    ).toThrow(/OIDC_CLIENT_ID/);
  });

  it('accepts OIDC enabled with integration-shaped config', () => {
    const env = parseEnv({
      NODE_ENV: 'development',
      JWT_SECRET: 'change-me-in-production',
      OIDC_ENABLED: 'true',
      OIDC_ISSUER: 'https://oidc.integration.account.gov.uk',
      OIDC_CLIENT_ID: 'test-client',
      OIDC_CLIENT_SECRET: 'test-secret',
      OIDC_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/oidc/callback',
      OIDC_VTR: '["Cl.Cm"]',
    });

    expect(env.OIDC_ENABLED).toBe(true);
    expect(env.OIDC_CLIENT_ID).toBe('test-client');
  });

  it('rejects production with OIDC enabled but no session secret', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(32),
        SWAGGER_PASSWORD: 'strong-pass-12',
        OIDC_ENABLED: 'true',
        OIDC_ISSUER: 'https://oidc.integration.account.gov.uk',
        OIDC_CLIENT_ID: 'test-client',
        OIDC_CLIENT_SECRET: 'test-secret',
        OIDC_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/oidc/callback',
        OIDC_SESSION_SECRET: 'short',
      }),
    ).toThrow(/OIDC_SESSION_SECRET/);
  });

  it('rejects production with OIDC enabled but no client secret', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(32),
        SWAGGER_PASSWORD: 'strong-pass-12',
        OIDC_ENABLED: 'true',
        OIDC_ISSUER: 'https://oidc.integration.account.gov.uk',
        OIDC_CLIENT_ID: 'test-client',
        OIDC_CLIENT_SECRET: '',
        OIDC_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/oidc/callback',
      }),
    ).toThrow(/OIDC_CLIENT_SECRET/);
  });

  it('rejects production with a short JWT secret', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'too-short',
        SWAGGER_PASSWORD: 'twelvechars12',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('rejects production without Swagger password', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        JWT_SECRET: 'x'.repeat(32),
        SWAGGER_PASSWORD: '',
      }),
    ).toThrow(/SWAGGER_PASSWORD/);
  });

  it('accepts production with strong secrets', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(32),
      SWAGGER_PASSWORD: 'strong-pass-12',
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.CRON_DAS_SYNC_ENABLED).toBe(true);
    expect(env.CRON_DAS_FUNDING_SYNC_ENABLED).toBe(true);
    expect(env.CRON_OTJ_PACE_ENABLED).toBe(true);
    expect(env.CRON_REVIEW_REMINDERS_ENABLED).toBe(true);
    expect(env.CRON_RETENTION_ENABLED).toBe(true);
    expect(env.CRON_COMMITMENT_CHASE_ENABLED).toBe(true);
    expect(env.CRON_DIGEST_ENABLED).toBe(true);
  });

  it('defaults staging cron flags to enabled when unset', () => {
    const env = parseEnv({
      NODE_ENV: 'staging',
      JWT_SECRET: 'x'.repeat(32),
      SWAGGER_PASSWORD: 'strong-pass-12',
    });

    expect(env.CRON_DAS_SYNC_ENABLED).toBe(true);
    expect(env.CRON_LEVY_EXPIRY_ALERTS_ENABLED).toBe(true);
  });

  it('allows explicit false cron overrides in production', () => {
    const env = parseEnv({
      NODE_ENV: 'production',
      JWT_SECRET: 'x'.repeat(32),
      SWAGGER_PASSWORD: 'strong-pass-12',
      CRON_DAS_SYNC_ENABLED: 'false',
    });

    expect(env.CRON_DAS_SYNC_ENABLED).toBe(false);
    expect(env.CRON_OTJ_PACE_ENABLED).toBe(true);
  });
});
