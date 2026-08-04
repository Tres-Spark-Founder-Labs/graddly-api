/* eslint-disable @typescript-eslint/naming-convention -- keys mirror process.env (UPPER_SNAKE_CASE) */

import { z } from 'zod';

const NODE_ENVS = ['development', 'test', 'production', 'staging'] as const;

/** Background crons default to enabled in staging/production when unset (PRD-022). */
export const DEPLOYED_CRON_FLAGS_DEFAULT_TRUE = [
  'CRON_DAS_SYNC_ENABLED',
  'CRON_DAS_FUNDING_SYNC_ENABLED',
  'CRON_OTJ_PACE_ENABLED',
  'CRON_REVIEW_OVERDUE_ENABLED',
  'CRON_REVIEW_REMINDERS_ENABLED',
  'CRON_COMMITMENT_CHASE_ENABLED',
  'CRON_DIGEST_ENABLED',
  'CRON_LEVY_EXPIRY_ALERTS_ENABLED',
  'CRON_LEVY_TRANSFER_STATUS_ENABLED',
  'CRON_LEVY_ROI_MONTHLY_ENABLED',
  'CRON_EIF_SNAPSHOT_ENABLED',
  'CRON_CASELOAD_ALERTS_ENABLED',
  'CRON_RETENTION_ENABLED',
] as const;

export function applyDeployedCronDefaults(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnv =
    typeof raw.NODE_ENV === 'string'
      ? raw.NODE_ENV
      : (process.env.NODE_ENV ?? 'development');
  const deployed = nodeEnv === 'production' || nodeEnv === 'staging';
  if (!deployed) {
    return raw;
  }

  const out = { ...raw };
  for (const key of DEPLOYED_CRON_FLAGS_DEFAULT_TRUE) {
    if (out[key] === undefined) {
      out[key] = 'true';
    }
  }
  return out;
}

/** Raw process env: strings or undefined (Nest passes a plain record). */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),

    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DB_HOST: z.string().min(1).default('localhost'),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_USERNAME: z.string().min(1).default('graddly'),
    DB_PASSWORD: z.string().default(''),
    DB_NAME: z.string().min(1).default('graddly'),
    /** When unset, TypeORM logs SQL in development only. Set explicitly to override. */
    DB_LOGGING_ENABLED: z
      .string()
      .optional()
      .transform((v) => {
        if (v === undefined || v.trim() === '') return undefined;
        return v === 'true';
      }),

    JWT_SECRET: z.string().default('change-me-in-production'),
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
    REFRESH_REUSE_GRACE_SECONDS: z.coerce
      .number()
      .int()
      .min(0)
      .max(300)
      .default(30),

    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_PASSWORD: z.string().optional(),

    BULLMQ_PREFIX: z.string().min(1).default('graddly'),

    CRON_ENABLED: z
      .string()
      .optional()
      .default('true')
      .transform((v) => v !== 'false'),

    CRON_HEALTH_SCHEDULE: z.string().min(1).default('*/5 * * * *'),

    CRON_LOCK_ENABLED: z
      .string()
      .optional()
      .default('true')
      .transform((v) => v !== 'false'),

    CRON_LOCK_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(3600)
      .default(240),

    CRON_DIGEST_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),

    // F1.2.3 AC6/AC7. Now daily rather than Monday-only: frequency is a
    // per-user setting (daily/weekly/off) and a Monday-only job could never
    // serve a manager who asked for daily. The weekly cohort is filtered to
    // Mondays at send time instead.
    CRON_DIGEST_SCHEDULE: z.string().min(1).default('0 8 * * *'),
    // Without this the expression is evaluated in the server's local zone, so
    // "08:00" means whatever the host says it means. See the note in
    // EMPLOYER-PORTAL-IMPLEMENTATION.md on GMT vs Europe/London.
    CRON_DIGEST_TIMEZONE: z.string().min(1).default('Europe/London'),

    QUEUE_OPS_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),

    QUEUE_OPS_API_KEY: z.string().optional().default(''),

    THROTTLE_ENABLED: z
      .string()
      .optional()
      .default('true')
      .transform((v) => v !== 'false'),

    TENANT_DB_CONTEXT_ENABLED: z
      .string()
      .optional()
      .default('true')
      .transform((v) => v !== 'false'),

    SWAGGER_PASSWORD: z.string().optional().default(''),
    LOGGLY_TOKEN: z.string().optional().default(''),
    LOGGLY_SUBDOMAIN: z.string().optional().default(''),

    SENTRY_DSN: z.string().optional().default(''),
    SENTRY_ENVIRONMENT: z.string().optional().default(''),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
    SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

    OIDC_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),

    OIDC_ISSUER: z.string().url().optional(),
    OIDC_DISCOVERY_URL: z.string().url().optional(),
    OIDC_CLIENT_ID: z.string().optional().default(''),
    OIDC_CLIENT_SECRET: z.string().optional().default(''),
    OIDC_REDIRECT_URI: z.string().url().optional(),
    OIDC_SCOPES: z.string().min(1).default('openid email'),
    OIDC_UI_LOCALES: z.string().min(1).default('en'),
    OIDC_VTR: z.string().optional().default(''),

    OIDC_SESSION_SECRET: z.string().optional().default(''),
    OIDC_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(600),
    OIDC_SUCCESS_REDIRECT_URI: z.string().url().optional(),

    OIDC_PROVISIONING_MODE: z
      .enum(['auto_create', 'link_existing'])
      .default('auto_create'),

    RESEND_API_KEY: z.string().optional().default(''),
    RESEND_FROM_EMAIL: z.string().optional().default(''),
    EMAIL_PROVIDER: z.enum(['resend', 'noop']).default('noop'),
    PASSWORD_RESET_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(86_400)
      .default(3600),
    EMAIL_VERIFICATION_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(172_800)
      .default(86_400),
    FRONTEND_BASE_EMPLOYER_URL: z.string().url().optional(),
    FRONTEND_BASE_PROVIDER_URL: z.string().url().optional(),
    FRONTEND_BASE_APPRENTICE_URL: z.string().url().optional(),
    FRONTEND_BASE_FLOW_URL: z.string().url().optional(),
    FRONTEND_BASE_URL: z.string().url().optional(),
    INVITATION_ACCEPT_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(604_800)
      .default(604_800),

    STORAGE_PROVIDER: z.enum(['s3', 'noop']).default('noop'),
    AWS_REGION: z.string().min(1).default('eu-west-2'),
    S3_BUCKET: z.string().optional().default(''),
    AWS_ACCESS_KEY_ID: z.string().optional().default(''),
    AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
    S3_PRESIGN_UPLOAD_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(900),
    S3_PRESIGN_DOWNLOAD_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(300),

    PDF_PROVIDER: z.enum(['pdfkit', 'noop']).default('pdfkit'),

    DAS_BASE_URL: z.string().url().optional().default(''),
    DAS_TOKEN_URL: z.string().url().optional().default(''),
    DAS_CLIENT_ID: z.string().optional().default(''),
    DAS_CLIENT_SECRET: z.string().optional().default(''),
    DAS_SCOPE: z.string().optional().default(''),
    DAS_LEVY_BALANCE_PATH: z.string().min(1).default('/api/levy/balance'),
    DAS_LEVY_TRANSFER_CONSENT_PATH: z
      .string()
      .min(1)
      .default('/api/levy/transfers/consent'),
    DAS_LEVY_TRANSFER_STATUS_PATH: z
      .string()
      .min(1)
      .default('/api/levy/transfers/status'),
    DAS_ENROLMENT_SUBMIT_PATH: z
      .string()
      .min(1)
      .default('/api/apprenticeships/enrolments'),
    DAS_COMPLETION_NOTIFY_PATH: z
      .string()
      .min(1)
      .default('/api/apprenticeships/completions'),
    DAS_FUNDING_PAYMENTS_PATH: z
      .string()
      .min(1)
      .default('/api/funding/payments'),
    DAS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),

    DAS_DONOR_OAUTH_AUTHORIZE_URL: z.string().url().optional().default(''),
    DAS_DONOR_OAUTH_TOKEN_URL: z.string().url().optional().default(''),
    DAS_DONOR_OAUTH_CLIENT_ID: z.string().optional().default(''),
    DAS_DONOR_OAUTH_CLIENT_SECRET: z.string().optional().default(''),
    DAS_DONOR_OAUTH_REDIRECT_URI: z.string().url().optional().default(''),
    DAS_DONOR_OAUTH_SCOPE: z.string().optional().default(''),
    DAS_DONOR_TOKEN_ENCRYPTION_KEY: z.string().optional().default(''),

    CRON_DAS_SYNC_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),
    CRON_DAS_SYNC_SCHEDULE: z.string().min(1).default('*/15 * * * *'),

    CRON_DAS_FUNDING_SYNC_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),
    CRON_DAS_FUNDING_SYNC_SCHEDULE: z.string().min(1).default('0 2 * * *'),

    CRON_OTJ_PACE_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),
    CRON_OTJ_PACE_SCHEDULE: z.string().min(1).default('0 1 * * *'),

    CRON_REVIEW_OVERDUE_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),
    CRON_REVIEW_OVERDUE_SCHEDULE: z.string().min(1).default('0 2 * * *'),

    CRON_REVIEW_REMINDERS_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),
    CRON_REVIEW_REMINDERS_SCHEDULE: z.string().min(1).default('0 * * * *'),

    CRON_COMMITMENT_CHASE_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),
    CRON_COMMITMENT_CHASE_SCHEDULE: z.string().min(1).default('0 6 * * *'),

    CRON_LEVY_EXPIRY_ALERTS_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),

    CRON_LEVY_EXPIRY_ALERTS_SCHEDULE: z.string().min(1).default('0 8 * * *'),

    // F1.4.1 AC5 — monthly levy ROI report to configured recipients.
    CRON_LEVY_ROI_MONTHLY_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),

    // 07:00 on the 1st of each month.
    CRON_LEVY_ROI_MONTHLY_SCHEDULE: z.string().min(1).default('0 7 1 * *'),

    // F2.1.1 — nightly EIF score snapshot for the twelve-month trend.
    CRON_EIF_SNAPSHOT_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),

    CRON_EIF_SNAPSHOT_SCHEDULE: z.string().min(1).default('0 2 * * *'),

    // F2.2.5 AC3 — alert programme managers when a tutor is carrying too
    // many at-risk learners. 07:30, so it lands before the working day and
    // after the nightly OTJ pace and review-overdue jobs have settled.
    CRON_CASELOAD_ALERTS_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),

    CRON_CASELOAD_ALERTS_SCHEDULE: z.string().min(1).default('30 7 * * *'),

    // The at-risk count above which a tutor is flagged. Configurable per the
    // criterion, which names 5 as the default.
    CASELOAD_AT_RISK_THRESHOLD: z.coerce.number().int().min(1).default(5),

    CRON_LEVY_TRANSFER_STATUS_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),

    CRON_LEVY_TRANSFER_STATUS_SCHEDULE: z.string().min(1).default('0 3 * * *'),

    RETENTION_AUDIT_YEARS: z.coerce.number().int().min(1).max(25).default(7),
    RETENTION_SOFT_DELETE_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(90),
    RETENTION_NOTIFICATION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(365),

    CRON_RETENTION_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),
    CRON_RETENTION_SCHEDULE: z.string().min(1).default('0 4 * * 0'),

    PLATFORM_OPS_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),
    PLATFORM_OPS_API_KEY: z.string().optional().default(''),

    PORTFOLIO_HEATMAP_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(0)
      .max(86_400)
      .default(0),

    EIF_SCORE_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(0)
      .max(86_400)
      .default(3600),

    WITHDRAWAL_PUSH_ENDPOINT_URL: z.string().url().optional().default(''),

    ILR_ESFA_PROVIDER: z.enum(['noop', 'http']).default('noop'),
    ILR_ESFA_BASE_URL: z.string().url().optional().default(''),
    ILR_ESFA_TOKEN_URL: z.string().url().optional().default(''),
    ILR_ESFA_CLIENT_ID: z.string().optional().default(''),
    ILR_ESFA_CLIENT_SECRET: z.string().optional().default(''),
    ILR_ESFA_SCOPE: z.string().optional().default(''),
    ILR_ESFA_SUBMIT_PATH: z.string().min(1).default('/api/v1/ilr/submit'),
    ILR_ESFA_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60000)
      .default(15000),
    ILR_ESFA_PAYLOAD_FORMAT: z.enum(['json', 'xml']).default('xml'),
    ILR_CONFIG_WRITE_ENABLED: z
      .string()
      .optional()
      .default('false')
      .transform((v) => v === 'true'),

    ENROLMENT_AUTO_INVITE_APPRENTICE: z
      .string()
      .optional()
      .default('true')
      .transform((v) => v !== 'false'),

    COMPANIES_HOUSE_API_KEY: z.string().optional().default(''),

    MFA_ENCRYPTION_KEY: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    const deployed =
      data.NODE_ENV === 'production' || data.NODE_ENV === 'staging';

    if (!deployed) {
      return;
    }

    const weakJwt =
      !data.JWT_SECRET ||
      data.JWT_SECRET.length < 32 ||
      data.JWT_SECRET === 'change-me-in-production';

    if (weakJwt) {
      ctx.addIssue({
        code: 'custom',
        message:
          'JWT_SECRET must be set to a strong secret (min 32 characters) and must not use the development default when NODE_ENV is production or staging.',
        path: ['JWT_SECRET'],
      });
    }

    if (!data.SWAGGER_PASSWORD || data.SWAGGER_PASSWORD.length < 12) {
      ctx.addIssue({
        code: 'custom',
        message:
          'SWAGGER_PASSWORD must be set (min 12 characters) when NODE_ENV is production or staging.',
        path: ['SWAGGER_PASSWORD'],
      });
    }

    if (data.QUEUE_OPS_ENABLED) {
      const weakOpsKey =
        !data.QUEUE_OPS_API_KEY?.trim() || data.QUEUE_OPS_API_KEY.length < 32;

      if (weakOpsKey) {
        ctx.addIssue({
          code: 'custom',
          message:
            'QUEUE_OPS_API_KEY must be set (min 32 characters) when QUEUE_OPS_ENABLED is true and NODE_ENV is production or staging.',
          path: ['QUEUE_OPS_API_KEY'],
        });
      }
    }

    if (data.PLATFORM_OPS_ENABLED) {
      const weakPlatformKey =
        !data.PLATFORM_OPS_API_KEY?.trim() ||
        data.PLATFORM_OPS_API_KEY.length < 32;

      if (weakPlatformKey) {
        ctx.addIssue({
          code: 'custom',
          message:
            'PLATFORM_OPS_API_KEY must be set (min 32 characters) when PLATFORM_OPS_ENABLED is true and NODE_ENV is production or staging.',
          path: ['PLATFORM_OPS_API_KEY'],
        });
      }
    }

    if (data.EMAIL_PROVIDER === 'resend' && deployed) {
      if (!data.RESEND_API_KEY?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message:
            'RESEND_API_KEY must be set when EMAIL_PROVIDER is resend and NODE_ENV is production or staging.',
          path: ['RESEND_API_KEY'],
        });
      }

      if (!data.RESEND_FROM_EMAIL?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message:
            'RESEND_FROM_EMAIL must be set when EMAIL_PROVIDER is resend and NODE_ENV is production or staging.',
          path: ['RESEND_FROM_EMAIL'],
        });
      }
    }

    if (data.STORAGE_PROVIDER === 's3' && deployed) {
      if (!data.S3_BUCKET?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message:
            'S3_BUCKET must be set when STORAGE_PROVIDER is s3 and NODE_ENV is production or staging.',
          path: ['S3_BUCKET'],
        });
      }
    }

    if (data.OIDC_ENABLED && deployed) {
      if (!data.OIDC_CLIENT_SECRET?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message:
            'OIDC_CLIENT_SECRET must be set when OIDC_ENABLED is true and NODE_ENV is production or staging.',
          path: ['OIDC_CLIENT_SECRET'],
        });
      }

      const weakSessionSecret =
        !data.OIDC_SESSION_SECRET?.trim() ||
        data.OIDC_SESSION_SECRET.length < 32;

      if (weakSessionSecret) {
        ctx.addIssue({
          code: 'custom',
          message:
            'OIDC_SESSION_SECRET must be set (min 32 characters) when OIDC_ENABLED is true and NODE_ENV is production or staging.',
          path: ['OIDC_SESSION_SECRET'],
        });
      }
    }
  })
  .superRefine((data, ctx) => {
    if (!data.OIDC_ENABLED) {
      return;
    }

    if (!data.OIDC_CLIENT_ID?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'OIDC_CLIENT_ID is required when OIDC_ENABLED is true.',
        path: ['OIDC_CLIENT_ID'],
      });
    }

    if (!data.OIDC_CLIENT_SECRET?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'OIDC_CLIENT_SECRET is required when OIDC_ENABLED is true.',
        path: ['OIDC_CLIENT_SECRET'],
      });
    }

    if (!data.OIDC_REDIRECT_URI) {
      ctx.addIssue({
        code: 'custom',
        message: 'OIDC_REDIRECT_URI is required when OIDC_ENABLED is true.',
        path: ['OIDC_REDIRECT_URI'],
      });
    }

    const hasDiscovery =
      Boolean(data.OIDC_DISCOVERY_URL?.trim()) ||
      Boolean(data.OIDC_ISSUER?.trim());

    if (!hasDiscovery) {
      ctx.addIssue({
        code: 'custom',
        message:
          'OIDC_DISCOVERY_URL or OIDC_ISSUER is required when OIDC_ENABLED is true.',
        path: ['OIDC_DISCOVERY_URL'],
      });
    }

    if (data.OIDC_VTR?.trim()) {
      try {
        const parsed: unknown = JSON.parse(data.OIDC_VTR);
        if (
          !Array.isArray(parsed) ||
          !parsed.every((item) => typeof item === 'string')
        ) {
          throw new Error('invalid');
        }
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'OIDC_VTR must be a JSON array of strings when set.',
          path: ['OIDC_VTR'],
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;
