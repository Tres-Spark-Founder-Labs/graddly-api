# Performance (PERF-001)

PRD §7.1 targets: read endpoints p95 &lt;500ms, write endpoints p95 &lt;800ms.

## Index inventory

Migration [`1780800000000-PerfIndexReview`](../src/migrations/1780800000000-PerfIndexReview.ts) adds indexes validated against hot query paths.

### OTJ log entries

| Index | Columns | Query alignment |
|-------|---------|-----------------|
| `IDX_otj_log_entries_org_status_created` | `(organisationId, status, createdAt)` | Filtered list by status |
| `IDX_otj_log_entries_org_created` | `(organisationId, createdAt DESC)` WHERE `isDeleted=false` | Default list order in `OtjLogEntriesService.findAll` |
| `IDX_otj_log_entries_org_apprentice_logged_date` | `(organisationId, apprenticeId, loggedDate)` | Apprentice-scoped views |
| `IDX_otj_log_entries_org_enrolment_logged_date` | `(organisationId, enrolmentId, loggedDate)` | Enrolment-scoped views |

### Audit log entries

| Index | Columns | Query alignment |
|-------|---------|-----------------|
| `IDX_audit_log_org_created` | `(organisationId, createdAt DESC)` | Org export default sort |
| `IDX_audit_log_org_entity_created` | `(organisationId, entityType, createdAt DESC)` | Export with `entityType` filter |
| `IDX_audit_log_entity_created` | `(entityType, entityId, createdAt DESC)` | Entity history |

### Notifications

| Index | Columns | Query alignment |
|-------|---------|-----------------|
| `IDX_notifications_user_read_created` | `(userId, readAt, createdAt DESC)` | User inbox sort |
| `IDX_notifications_user_org` | `(userId, organisationId)` | Org-scoped inbox |
| `IDX_notifications_user_unread` | `(userId)` WHERE unread | `unreadOnly` filter |

### Enrolments

| Index | Columns | Query alignment |
|-------|---------|-----------------|
| `IDX_enrolments_org_employer_org` | `(organisationId, employerOrganisationId)` | Levy ROI employer breakdown |
| `IDX_enrolments_org_provider_org` | `(organisationId, providerOrganisationId)` | Provider ROI breakdown |
| `IDX_enrolments_active_status` | `(status)` WHERE `isDeleted=false` | OTJ pace nightly cron scan |

## Load-test checklist

Run against **staging** with realistic data volume. Install [k6](https://k6.io/docs/get-started/installation/) locally or use the project script.

```bash
export BASE_URL=https://staging-api.graddly.com
export TEST_EMAIL=load-test@example.com
export TEST_PASSWORD='...'
export ORG_ID='...'
yarn load:smoke
```

| Endpoint | Method | p95 target | Auth | Notes |
|----------|--------|------------|------|-------|
| `/api/v1/otj-log-entries` | GET | &lt;500ms | JWT + org header | Primary list path |
| OTJ submit / approve | POST/PATCH | &lt;800ms | JWT + org | Write path |
| `/api/v1/audit/export` | GET | &lt;500ms | OWNER JWT | Paginated export |
| `/api/v1/notifications` | GET | &lt;500ms | JWT | Unread filter optional |
| `/api/v1/reporting/levy-roi` | GET | &lt;500ms | Employer portal JWT | Reporting hot path |

### k6 smoke script

Script: [`load/k6/smoke.js`](../load/k6/smoke.js)

Thresholds (from PRD §7.1):

- `http_req_duration`: p95 &lt; 500ms for read scenarios
- `http_req_failed`: rate &lt; 1%

### CI

Optional manual `workflow_dispatch` job only — not blocking PR CI. Run smoke against staging before major releases.

## Sign-off (PERF-001)

Record staging k6 results in [`load/k6/results/`](../load/k6/results/) (see [`2026-06-08-smoke.md`](../load/k6/results/2026-06-08-smoke.md)). Ops completes the staging run and fills the summary table before production release.

## EXPLAIN notes

When investigating slow queries, use `EXPLAIN (ANALYZE, BUFFERS)` on staging with production-like row counts. Prefer index additions only after confirming sequential scans on listed paths.
