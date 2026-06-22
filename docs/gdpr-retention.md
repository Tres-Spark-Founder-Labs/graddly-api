# GDPR data retention (GDP-001)

Config-driven retention jobs purge expired audit logs, soft-deleted rows, and old read notifications. Right-to-erasure (GDP-002) is documented in the [erasure runbook](#right-to-erasure-gdp-002) below.

## Policy (v1)

| Data | TTL | Env key | Action |
|------|-----|---------|--------|
| Audit log entries | 7 years | `RETENTION_AUDIT_YEARS` | Hard delete after window (PRD §7.2 audit retention) |
| Soft-deleted rows | 90 days | `RETENTION_SOFT_DELETE_DAYS` | Hard delete `notifications`, `messages`, `message_threads`, `invitations` where `isDeleted=true` |
| Read notifications | 365 days | `RETENTION_NOTIFICATION_DAYS` | Hard delete read notifications by `createdAt` |

**Not in v1:** S3 object lifecycle (presigned URLs are TTL-bound; configure bucket lifecycle in infra).

## Cron configuration

Runs in the **worker** process only (`SchedulerModule`).

| Env | Default | Description |
|-----|---------|-------------|
| `CRON_RETENTION_ENABLED` | `false` | Opt-in, matches other crons |
| `CRON_RETENTION_SCHEDULE` | `0 4 * * 0` | Weekly Sunday 04:00 UTC |

Implementation: [`src/data-retention/`](../src/data-retention/).

## Platform ops API (GDP-001)

When `PLATFORM_OPS_ENABLED=true` and `PLATFORM_OPS_API_KEY` is set (min 32 chars in staging/production):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/platform/retention/runs` | Paginated retention run history |
| `POST` | `/api/v1/platform/retention/run` | Run purge immediately (ignores `CRON_RETENTION_ENABLED`) |

```bash
curl "$BASE_URL/api/v1/platform/retention/runs?page=1&perPage=20" \
  -H "X-Platform-Ops-Api-Key: $PLATFORM_OPS_API_KEY"

curl -X POST "$BASE_URL/api/v1/platform/retention/run" \
  -H "X-Platform-Ops-Api-Key: $PLATFORM_OPS_API_KEY"
```

Automated weekly runs are also recorded when `CRON_RETENTION_ENABLED=true` in the worker.

## What is / isn't purged

**Purged:**

- `audit_log_entries` older than `RETENTION_AUDIT_YEARS`
- Soft-deleted housekeeping rows past `RETENTION_SOFT_DELETE_DAYS`
- Read notifications older than `RETENTION_NOTIFICATION_DAYS`

**Retained:**

- Active enrolments and financial records
- Audit metadata within the 7-year window
- S3 objects (manual / infra lifecycle)

## Right to erasure (GDP-002)

Platform ops endpoint (not org self-service in v1):

```bash
curl -X POST "$BASE_URL/api/v1/platform/gdpr/erasure" \
  -H "Content-Type: application/json" \
  -H "X-Platform-Ops-Api-Key: $PLATFORM_OPS_API_KEY" \
  -d '{"subjectType":"user","subjectId":"<uuid>","reason":"ICO request ref 123"}'
```

| Env | Description |
|-----|-------------|
| `PLATFORM_OPS_ENABLED` | Must be `true` |
| `PLATFORM_OPS_API_KEY` | Min 32 chars in staging/production |

**Behaviour:**

- Anonymises user or apprentice PII in place (FK integrity preserved)
- Revokes refresh tokens for user subjects
- Scrubs PII inside `audit_log_entries.changes` JSON; sets `actorUserId` to null where applicable
- Retains audit row metadata: `id`, `createdAt`, `organisationId`, `entityType`, `entityId`, `action`
- Inserts an `erase` audit log entry for the operation

**Not in v1:** org-admin self-service, automated DSAR export, S3 object deletion (manual ops step).

## Verification

```bash
yarn test data-retention
yarn test erasure
yarn test:e2e platform-gdpr
yarn test:e2e platform-retention
```
