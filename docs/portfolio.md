# Portfolio — KSB evidence (Phase P)

Apprentices attach evidence (file, link, or text) to Knowledge, Skills, and Behaviours (KSBs) on their enrolment’s standard. Tutors review evidence and assess coverage on a heatmap grid.

## Domain model

| Table | Purpose |
|-------|---------|
| `ksb_definitions` | KSB catalogue per standard (`K1`, `S1`, `B1`, …) |
| `ks_evidence_items` | Evidence rows per enrolment |
| `ks_evidence_ksb_mappings` | Many-to-many tags |
| `enrolment_ksb_coverage` | Tutor cell assessment (`sufficient` / `needs_more`) |

## Status workflow

```
draft → submitted → reviewed → accepted
         ↑___________________|  POST …/return (tutor/admin)
```

Only `draft` evidence can be edited or deleted.

## Storage

- File evidence uses presigned upload (`StorageObjectCategory.EVIDENCE`) with `learnerId` set to the **apprentice** UUID.
- Keys must match `orgs/{orgId}/learners/{apprenticeId}/evidence/...`.
- Convenience endpoint: `POST /api/v1/ksb-evidence-items/upload-url` (wraps generic storage API).

## APIs

### KSB catalogue

| Method | Path |
|--------|------|
| `POST` | `/api/v1/standards/:standardId/ksb-definitions` |
| `GET` | `/api/v1/standards/:standardId/ksb-definitions` |
| `PATCH` | `/api/v1/ksb-definitions/:id` |
| `DELETE` | `/api/v1/ksb-definitions/:id` |

### Evidence

| Method | Path |
|--------|------|
| `POST` | `/api/v1/ksb-evidence-items/upload-url` |
| `POST` | `/api/v1/ksb-evidence-items` |
| `GET` | `/api/v1/ksb-evidence-items` |
| `GET` | `/api/v1/ksb-evidence-items/:id` |
| `PATCH` | `/api/v1/ksb-evidence-items/:id` |
| `POST` | `/api/v1/ksb-evidence-items/:id/submit` |
| `POST` | `/api/v1/ksb-evidence-items/:id/review` |
| `POST` | `/api/v1/ksb-evidence-items/:id/accept` |
| `POST` | `/api/v1/ksb-evidence-items/:id/return` |
| `DELETE` | `/api/v1/ksb-evidence-items/:id` |

### Heatmap

| Method | Path |
|--------|------|
| `GET` | `/api/v1/portfolio/ksb-heatmap?enrolmentId=` |
| `PUT` | `/api/v1/portfolio/enrolments/:enrolmentId/ksb-coverage/:ksbDefinitionId` |

### EPA evidence pack

| Method | Path |
|--------|------|
| `POST` | `/api/v1/portfolio/epa-pack-jobs` |
| `GET` | `/api/v1/portfolio/epa-pack-jobs/:id` |

See [epa-evidence-pack.md](./epa-evidence-pack.md).

Heatmap **strength** is derived from **accepted** evidence count per KSB: `0` → none, `1` → low, `2+` → adequate.

Optional Redis cache: `PORTFOLIO_HEATMAP_CACHE_TTL_SECONDS` (default `0` = disabled).

## Audit

Lifecycle changes on `ksb_definitions`, `ks_evidence_items`, `ks_evidence_ksb_mappings`, and `enrolment_ksb_coverage` are written to `audit_log_entries`. Export via `GET /api/v1/audit/export?entityType=ks_evidence_items`.

## Notifications

`NotificationType.PORTFOLIO` is used for accept events (and can be extended for submit/review).
