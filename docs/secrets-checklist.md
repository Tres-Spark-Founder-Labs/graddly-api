# Secrets and environment checklist (staging / production)

Use this when provisioning or rotating credentials for **staging** and **production**. Local development may use defaults from [`.env.example`](../.env.example); deployed environments must satisfy the Zod rules in [`src/config/env.schema.ts`](../src/config/env.schema.ts) (`NODE_ENV` `production` or `staging`).

## Required before go-live

| Item | Variable | Notes |
|------|-----------|--------|
| JWT signing key | `JWT_SECRET` | Min **32** characters. Never use `change-me-in-production`. Rotate if leaked. |
| API docs (Scalar) basic auth | `SWAGGER_PASSWORD` | Min **12** characters when `NODE_ENV` is `production` or `staging`. Protects **/docs**. |
| Database | `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | Use managed Postgres where possible; restrict network access; unique password per environment. See [database-setup.md](./database-setup.md) for migrator vs app roles and RLS. |
| Redis | `REDIS_HOST`, `REDIS_PORT` | TLS and auth if exposed beyond the private network. Used by KV, sessions, throttling, and BullMQ. |
| BullMQ key prefix | `BULLMQ_PREFIX` | Optional; default `graddly`. Namespace for job queue keys in Redis. API and worker processes must share the same value. |
| Cron jobs | `CRON_ENABLED`, `CRON_HEALTH_SCHEDULE` | Crons run in the **worker** process only. Set `CRON_ENABLED=false` to disable all crons. Default health sample: every 5 minutes (`*/5 * * * *`). |
| Cron distributed lock | `CRON_LOCK_ENABLED`, `CRON_LOCK_TTL_SECONDS` | When multiple worker replicas run, Redis `SET NX` ensures one instance per tick. Default TTL 240s; set below the cron interval. Disable with `CRON_LOCK_ENABLED=false` only for local debugging. |
| Production worker crons | See table below | When `NODE_ENV` is `staging` or `production`, unset `CRON_*_ENABLED` flags default to **`true`** (override with explicit `false`). In `development`/`test` they default to `false`. See [automation.md](./automation.md) and [gdpr-retention.md](./gdpr-retention.md). |
| Digest cron | `CRON_DIGEST_ENABLED`, `CRON_DIGEST_SCHEDULE` | Weekly OTJ manager digest. Default schedule: Monday 08:00 UTC (`0 8 * * 1`). |
| Queue ops (failed jobs) | `QUEUE_OPS_ENABLED`, `QUEUE_OPS_API_KEY` | Internal API at `/api/v1/ops/queues` (list failed jobs, retry, remove). Min **32** characters for the key when enabled in production/staging. Send header `X-Queue-Ops-Api-Key`. |
| Platform ops | `PLATFORM_OPS_ENABLED`, `PLATFORM_OPS_API_KEY` | GDPR erasure and retention ops APIs. Min **32** characters when enabled in production/staging. Header `X-Platform-Ops-Api-Key`. See [gdpr-retention.md](./gdpr-retention.md). |

### Production worker crons

All schedules run in the **worker** only. Requires `CRON_ENABLED=true` and `CRON_LOCK_ENABLED=true` when running multiple replicas.

| Cron | Enabled flag | Default schedule | Purpose |
|------|----------------|------------------|---------|
| DAS levy balance sync | `CRON_DAS_SYNC_ENABLED` | `*/15 * * * *` | 15-minute levy balance refresh (F1.1.1) |
| DAS funding payments | `CRON_DAS_FUNDING_SYNC_ENABLED` | `0 2 * * *` | Nightly funding payment sync |
| OTJ pace alerts | `CRON_OTJ_PACE_ENABLED` | `0 1 * * *` | Nightly EPA pace scan |
| Review overdue | `CRON_REVIEW_OVERDUE_ENABLED` | `0 2 * * *` | Mark overdue reviews |
| Review reminders | `CRON_REVIEW_REMINDERS_ENABLED` | `0 * * * *` | 48h / 7d / 1d reminders |
| Commitment chase | `CRON_COMMITMENT_CHASE_ENABLED` | `0 6 * * *` | 7-day unsigned chase |
| OTJ weekly digest | `CRON_DIGEST_ENABLED` | `0 8 * * 1` | Manager digest email |
| Levy expiry alerts | `CRON_LEVY_EXPIRY_ALERTS_ENABLED` | `0 8 * * *` | Expiring levy tranches |
| Levy transfer status | `CRON_LEVY_TRANSFER_STATUS_ENABLED` | `0 3 * * *` | Poll transfer status |
| GDPR retention | `CRON_RETENTION_ENABLED` | `0 4 * * 0` | Weekly purge — [gdpr-retention.md](./gdpr-retention.md) |

Retention TTL keys (not cron flags): `RETENTION_AUDIT_YEARS`, `RETENTION_SOFT_DELETE_DAYS`, `RETENTION_NOTIFICATION_DAYS`.

## Strongly recommended

| Item | Variable | Notes |
|------|-----------|--------|
| Error monitoring | `SENTRY_DSN` | Enables server-side reporting; keep DSN out of client bundles and public repos. |
| Sentry environment | `SENTRY_ENVIRONMENT` | Set to `staging` or `production` for clean issue separation. |
| Log shipping | `LOGGLY_TOKEN`, `LOGGLY_SUBDOMAIN` | Optional; omit in dev if unused. |

## When transactional email (Resend) is enabled

| Item | Variable | Notes |
|------|-----------|--------|
| Email provider | `EMAIL_PROVIDER` | Set to `resend` in deployed environments that send transactional email. |
| Resend API key | `RESEND_API_KEY` | From the [Resend dashboard](https://resend.com/api-keys). |
| From address | `RESEND_FROM_EMAIL` | Must use a verified domain (e.g. `Graddly <noreply@yourdomain.com>`). |
| Email dispatch | BullMQ `email` queue | Auth and invitations enqueue jobs; the **worker** process sends via Resend. Failed jobs appear in the ops API (`QUEUE_OPS_*`). |
| Frontend origin | `FRONTEND_BASE_URL` | Base URL for links in transactional email (see [password-reset.md](./password-reset.md), [email-verification.md](./email-verification.md)). |
| Verification TTL | `EMAIL_VERIFICATION_TOKEN_TTL_SECONDS` | Optional; default 24 hours. |
| Invitation accept token cap | `INVITATION_ACCEPT_TOKEN_TTL_SECONDS` | Optional; default 7 days; Redis TTL is clamped to invite `expiresAt`. See [invitations.md](./invitations.md). |

## When file storage (S3) is enabled

| Item | Variable | Notes |
|------|-----------|--------|
| Storage provider | `STORAGE_PROVIDER` | Set to `s3` in deployed environments that use presigned uploads. Default `noop` for local/test (fake URLs, no AWS). |
| S3 bucket | `S3_BUCKET` | Required when `STORAGE_PROVIDER=s3` in production/staging. One bucket per environment. |
| AWS region | `AWS_REGION` | Default `eu-west-2`. |
| AWS credentials | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Optional locally if using instance/task role in AWS. |
| Presign TTL | `S3_PRESIGN_UPLOAD_TTL_SECONDS`, `S3_PRESIGN_DOWNLOAD_TTL_SECONDS` | Upload default 900s; download default 300s. |

See [file-storage.md](./file-storage.md) for client upload flow and allowed MIME types.

| JWT access TTL | `JWT_ACCESS_EXPIRES_IN` | Default `15m`. See [auth-tokens.md](./auth-tokens.md). |
| JWT refresh TTL | `JWT_REFRESH_EXPIRES_IN` | Default `7d`. |
| Refresh reuse grace | `REFRESH_REUSE_GRACE_SECONDS` | Tombstone window after rotation (default `30`). |

## When GOV.UK One Login (OIDC) is enabled

| Item | Variable | Notes |
|------|-----------|--------|
| OIDC client | `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | From One Login service configuration; required when `OIDC_ENABLED=true`. See [oidc-one-login.md](./oidc-one-login.md). |
| Redirect URI | `OIDC_REDIRECT_URI` | Must match the URL registered in One Login for this environment. |
| OIDC session signing | `OIDC_SESSION_SECRET` | Min **32** characters in production/staging when OIDC is enabled. |

## When ILR ESFA submit (`http` provider) is enabled

| Item | Variable | Notes |
|------|-----------|--------|
| ILR ESFA provider | `ILR_ESFA_PROVIDER` | Set to `http` for OAuth REST stub; default `noop` needs no credentials. See [ilr.md](./ilr.md). |
| API base / token | `ILR_ESFA_BASE_URL`, `ILR_ESFA_TOKEN_URL` | Required when provider is `http`. |
| OAuth client | `ILR_ESFA_CLIENT_ID`, `ILR_ESFA_CLIENT_SECRET`, `ILR_ESFA_SCOPE` | Client credentials for ESFA sandbox/production when available. |
| Submit path | `ILR_ESFA_SUBMIT_PATH` | Default `/api/v1/ilr/submit`. |

## Operational hygiene

- Store secrets in your platform’s secret manager (e.g. AWS Secrets Manager, GCP Secret Manager, Vault), not only in flat `.env` files on disk.
- Rotate `JWT_SECRET` only with a coordinated token invalidation / client rollout plan.
- Never commit real `.env` files; rely on [`.env.example`](../.env.example) as a template only.
- After rotation, redeploy so all instances pick up new values.

## Validation at startup

The API validates environment variables at boot via **Zod** (`validateEnv` in [`src/config/validate-env.ts`](../src/config/validate-env.ts)). Misconfiguration fails fast with a clear error instead of failing mid-request.
