import { registerAs } from '@nestjs/config';

import { parseDurationToSeconds } from './jwt-duration.util.js';
import { parseOidcVtr, resolveOidcDiscoveryUrl } from './oidc-config.util.js';
import { getEnv } from './validate-env.js';

export default registerAs('app', () => {
  const e = getEnv();

  return {
    port: e.PORT,
    nodeEnv: e.NODE_ENV,
    swagger: {
      username: 'graddly',
      password: e.SWAGGER_PASSWORD || 'Gr4ddly!Sw4g@2026#Sec',
    },
    jwt: {
      secret: e.JWT_SECRET,
      accessExpiresIn: e.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: e.JWT_REFRESH_EXPIRES_IN,
      accessExpiresInSeconds: parseDurationToSeconds(
        e.JWT_ACCESS_EXPIRES_IN,
        900,
      ),
      refreshExpiresInSeconds: parseDurationToSeconds(
        e.JWT_REFRESH_EXPIRES_IN,
        604_800,
      ),
    },
    refresh: {
      reuseGraceSeconds: e.REFRESH_REUSE_GRACE_SECONDS,
    },
    throttle: {
      enabled: e.THROTTLE_ENABLED,
    },
    tenantDbContext: {
      enabled: e.TENANT_DB_CONTEXT_ENABLED,
    },
    redis: {
      host: e.REDIS_HOST,
      port: e.REDIS_PORT,
      password: e.REDIS_PASSWORD,
    },
    bullmq: {
      prefix: e.BULLMQ_PREFIX,
    },
    cron: {
      enabled: e.CRON_ENABLED,
      healthSchedule: e.CRON_HEALTH_SCHEDULE,
      lockEnabled: e.CRON_LOCK_ENABLED,
      lockTtlSeconds: e.CRON_LOCK_TTL_SECONDS,
      digestEnabled: e.CRON_DIGEST_ENABLED,
      digestSchedule: e.CRON_DIGEST_SCHEDULE,
      digestTimeZone: e.CRON_DIGEST_TIMEZONE,
      dasSyncEnabled: e.CRON_DAS_SYNC_ENABLED,
      dasSyncSchedule: e.CRON_DAS_SYNC_SCHEDULE,
      dasFundingSyncEnabled: e.CRON_DAS_FUNDING_SYNC_ENABLED,
      dasFundingSyncSchedule: e.CRON_DAS_FUNDING_SYNC_SCHEDULE,
      otjPaceEnabled: e.CRON_OTJ_PACE_ENABLED,
      otjPaceSchedule: e.CRON_OTJ_PACE_SCHEDULE,
      reviewOverdueEnabled: e.CRON_REVIEW_OVERDUE_ENABLED,
      reviewOverdueSchedule: e.CRON_REVIEW_OVERDUE_SCHEDULE,
      reviewRemindersEnabled: e.CRON_REVIEW_REMINDERS_ENABLED,
      reviewRemindersSchedule: e.CRON_REVIEW_REMINDERS_SCHEDULE,
      commitmentChaseEnabled: e.CRON_COMMITMENT_CHASE_ENABLED,
      commitmentChaseSchedule: e.CRON_COMMITMENT_CHASE_SCHEDULE,
      levyExpiryAlertsEnabled: e.CRON_LEVY_EXPIRY_ALERTS_ENABLED,
      levyExpiryAlertsSchedule: e.CRON_LEVY_EXPIRY_ALERTS_SCHEDULE,
      levyRoiMonthlyEnabled: e.CRON_LEVY_ROI_MONTHLY_ENABLED,
      levyRoiMonthlySchedule: e.CRON_LEVY_ROI_MONTHLY_SCHEDULE,
      levyTransferStatusEnabled: e.CRON_LEVY_TRANSFER_STATUS_ENABLED,
      levyTransferStatusSchedule: e.CRON_LEVY_TRANSFER_STATUS_SCHEDULE,
      retentionEnabled: e.CRON_RETENTION_ENABLED,
      retentionSchedule: e.CRON_RETENTION_SCHEDULE,
    },
    retention: {
      auditYears: e.RETENTION_AUDIT_YEARS,
      softDeleteDays: e.RETENTION_SOFT_DELETE_DAYS,
      notificationDays: e.RETENTION_NOTIFICATION_DAYS,
    },
    platformOps: {
      enabled: e.PLATFORM_OPS_ENABLED,
      apiKey: e.PLATFORM_OPS_API_KEY,
    },
    queueOps: {
      enabled: e.QUEUE_OPS_ENABLED,
      apiKey: e.QUEUE_OPS_API_KEY,
    },
    loggly: {
      token: e.LOGGLY_TOKEN,
      subdomain: e.LOGGLY_SUBDOMAIN,
    },
    sentry: {
      dsn: e.SENTRY_DSN.trim(),
      environment: e.SENTRY_ENVIRONMENT || e.NODE_ENV,
      tracesSampleRate: e.SENTRY_TRACES_SAMPLE_RATE,
      profilesSampleRate: e.SENTRY_PROFILES_SAMPLE_RATE,
    },
    oidc: {
      enabled: e.OIDC_ENABLED,
      discoveryUrl: resolveOidcDiscoveryUrl(e),
      issuer: e.OIDC_ISSUER?.trim() || undefined,
      clientId: e.OIDC_CLIENT_ID.trim(),
      clientSecret: e.OIDC_CLIENT_SECRET,
      redirectUri: e.OIDC_REDIRECT_URI,
      scopes: e.OIDC_SCOPES.split(/\s+/).filter(Boolean),
      uiLocales: e.OIDC_UI_LOCALES,
      vtr: parseOidcVtr(e.OIDC_VTR),
      sessionSecret:
        e.OIDC_SESSION_SECRET?.trim() ||
        e.JWT_SECRET ||
        'change-me-in-production',
      sessionTtlSeconds: e.OIDC_SESSION_TTL_SECONDS,
      successRedirectUri: e.OIDC_SUCCESS_REDIRECT_URI,
      provisioningMode: e.OIDC_PROVISIONING_MODE,
    },
    email: {
      provider: e.EMAIL_PROVIDER,
      resendApiKey: e.RESEND_API_KEY,
      from: e.RESEND_FROM_EMAIL,
      appName: 'Graddly',
      supportUrl: process.env.EMAIL_SUPPORT_URL?.trim() || undefined,
      privacyUrl: process.env.EMAIL_PRIVACY_URL?.trim() || undefined,
    },
    frontend: {
      portalUrls: {
        employer: e.FRONTEND_BASE_EMPLOYER_URL,
        provider: e.FRONTEND_BASE_PROVIDER_URL,
        apprentice: e.FRONTEND_BASE_APPRENTICE_URL,
        flow: e.FRONTEND_BASE_FLOW_URL,
      },
    },
    passwordReset: {
      tokenTtlSeconds: e.PASSWORD_RESET_TOKEN_TTL_SECONDS,
    },
    emailVerification: {
      tokenTtlSeconds: e.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
    },
    invitationAccept: {
      tokenTtlSeconds: e.INVITATION_ACCEPT_TOKEN_TTL_SECONDS,
    },
    storage: {
      provider: e.STORAGE_PROVIDER,
      region: e.AWS_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.AWS_ACCESS_KEY_ID,
      secretAccessKey: e.AWS_SECRET_ACCESS_KEY,
      presignUploadTtlSeconds: e.S3_PRESIGN_UPLOAD_TTL_SECONDS,
      presignDownloadTtlSeconds: e.S3_PRESIGN_DOWNLOAD_TTL_SECONDS,
    },
    pdf: {
      provider: e.PDF_PROVIDER,
    },
    das: {
      baseUrl: e.DAS_BASE_URL,
      tokenUrl: e.DAS_TOKEN_URL,
      clientId: e.DAS_CLIENT_ID,
      clientSecret: e.DAS_CLIENT_SECRET,
      scope: e.DAS_SCOPE,
      levyBalancePath: e.DAS_LEVY_BALANCE_PATH,
      transferConsentPath: e.DAS_LEVY_TRANSFER_CONSENT_PATH,
      transferStatusPath: e.DAS_LEVY_TRANSFER_STATUS_PATH,
      enrolmentSubmitPath: e.DAS_ENROLMENT_SUBMIT_PATH,
      completionNotifyPath: e.DAS_COMPLETION_NOTIFY_PATH,
      fundingPaymentsPath: e.DAS_FUNDING_PAYMENTS_PATH,
      timeoutMs: e.DAS_TIMEOUT_MS,
    },
    levyExchange: {
      donorOAuth: {
        authorizeUrl: e.DAS_DONOR_OAUTH_AUTHORIZE_URL,
        tokenUrl: e.DAS_DONOR_OAUTH_TOKEN_URL,
        clientId: e.DAS_DONOR_OAUTH_CLIENT_ID,
        clientSecret: e.DAS_DONOR_OAUTH_CLIENT_SECRET,
        redirectUri: e.DAS_DONOR_OAUTH_REDIRECT_URI,
        scope: e.DAS_DONOR_OAUTH_SCOPE,
        tokenEncryptionKey:
          e.DAS_DONOR_TOKEN_ENCRYPTION_KEY?.trim() || e.JWT_SECRET,
      },
    },
    withdrawalPush: {
      endpointUrl: e.WITHDRAWAL_PUSH_ENDPOINT_URL,
    },
    portfolio: {
      heatmapCacheTtlSeconds: e.PORTFOLIO_HEATMAP_CACHE_TTL_SECONDS,
    },
    ofsted: {
      eifScoreCacheTtlSeconds: e.EIF_SCORE_CACHE_TTL_SECONDS,
    },
    enrolment: {
      autoInviteApprentice: e.ENROLMENT_AUTO_INVITE_APPRENTICE,
    },
    ilr: {
      configWriteEnabled: e.ILR_CONFIG_WRITE_ENABLED,
      esfa: {
        provider: e.ILR_ESFA_PROVIDER,
        baseUrl: e.ILR_ESFA_BASE_URL,
        tokenUrl: e.ILR_ESFA_TOKEN_URL,
        clientId: e.ILR_ESFA_CLIENT_ID,
        clientSecret: e.ILR_ESFA_CLIENT_SECRET,
        scope: e.ILR_ESFA_SCOPE,
        submitPath: e.ILR_ESFA_SUBMIT_PATH,
        timeoutMs: e.ILR_ESFA_TIMEOUT_MS,
        payloadFormat: e.ILR_ESFA_PAYLOAD_FORMAT,
      },
    },
    flowportalRegistration: {
      companiesHouseApiKey: e.COMPANIES_HOUSE_API_KEY,
    },
    security: {
      mfaEncryptionKey: e.MFA_ENCRYPTION_KEY?.trim() || e.JWT_SECRET,
    },
  };
});
