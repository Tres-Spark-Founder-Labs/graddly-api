# OTJ Log Entries

Apprentice and employer OTJ (Off-the-Job) logging APIs: create draft entries, submit for approval, bulk approve/reject, and pace tracking.

**PRD:** [03-apprentice-portal.md](prd/03-apprentice-portal.md) — F3.1.1 (Quick OTJ Log Entry).

All routes require `Authorization: Bearer <token>` and an active organisation (`X-Organisation-Id` optional override; see [auth tokens](auth-tokens.md)).

## Key concepts

| Field | Meaning |
|-------|---------|
| `enrolmentId` | **Programme/course** — which enrolment the OTJ hours count toward |
| `category` | **Activity type** — how the time was spent (dropdown, not the course) |
| `activityName` | Short session label (max 80 chars, PRD “activity name”) |
| `note` | Optional extra commentary beyond `activityName` |
| `minutes` | Duration of the session |
| `evidence` | Optional JSON metadata; `files` array of org-scoped storage keys |

Do **not** use `category` for programme/course selection — that is always `enrolmentId`.

## Domain model

| Table / config | Purpose |
|----------------|---------|
| `otj_log_entries` | OTJ sessions per organisation (RLS-scoped) |
| `src/otj/config/otj-activity-categories.v1.json` | Versioned catalogue of 6 activity category slugs + labels |

### Activity category slugs (v1)

| Slug | Label |
|------|-------|
| `taught_learning` | Taught learning |
| `applied_project` | Applied project |
| `mentoring_coaching` | Mentoring & coaching |
| `job_shadowing` | Job shadowing |
| `off_site_learning` | Off-site learning |
| `other` | Other |

Use `GET /api/v1/otj-log-entries/categories` for the live list (preferred over hard-coding).

## Status workflow

```
draft → submitted → approved
                 ↘ rejected
```

- **Create** always starts in `draft`.
- **PATCH** with `status: submitted` moves draft → submitted.
- **Bulk approve/reject** operates on `submitted` entries only.

## Evidence storage keys

When attaching files, each key in `evidence.files` must match:

```
orgs/{organisationId}/learners/{apprenticeId}/evidence/…
```

Keys are returned from the storage upload flow. Using `enrolmentId` or wrong apprentice paths returns `400 Bad Request`.

## API examples

### List activity categories

```http
GET /api/v1/otj-log-entries/categories
Authorization: Bearer <token>
X-Organisation-Id: <org-uuid>
```

Example response:

```json
{
  "message": "OTJ activity categories retrieved successfully",
  "data": [
    { "slug": "taught_learning", "label": "Taught learning" },
    { "slug": "job_shadowing", "label": "Job shadowing" }
  ]
}
```

### Create OTJ log entry

```http
POST /api/v1/otj-log-entries
Authorization: Bearer <token>
X-Organisation-Id: <org-uuid>
Content-Type: application/json

{
  "enrolmentId": "660e8400-e29b-41d4-a716-446655440002",
  "apprenticeId": "660e8400-e29b-41d4-a716-446655440001",
  "activityName": "Shadowing senior engineer on release",
  "category": "job_shadowing",
  "loggedDate": "2026-01-15",
  "minutes": 120,
  "note": "Optional extra detail",
  "evidence": {
    "files": [
      "orgs/660e8400-e29b-41d4-a716-446655440000/learners/660e8400-e29b-41d4-a716-446655440001/evidence/uuid/photo.jpg"
    ]
  }
}
```

### List OTJ log entries

```http
GET /api/v1/otj-log-entries?category=job_shadowing&status=draft&page=1&perPage=20
Authorization: Bearer <token>
X-Organisation-Id: <org-uuid>
```

### Submit for approval

```http
PATCH /api/v1/otj-log-entries/{id}
Authorization: Bearer <token>
X-Organisation-Id: <org-uuid>
Content-Type: application/json

{ "status": "submitted" }
```

### Bulk approve

```http
POST /api/v1/otj-log-entries/bulk-approve
Authorization: Bearer <token>
X-Organisation-Id: <org-uuid>
Content-Type: application/json

{ "ids": ["<otj-log-entry-uuid>"] }
```

## Swagger

Full request/response schemas and validation rules are documented under **OTJ Log Entries** in Swagger UI (`/api/docs` when enabled).

## Migration

After deploy, run migrations so `activityName` and `category` columns exist on `otj_log_entries`. Existing rows are backfilled: `activityName` from `note` (truncated) or `'Untitled activity'`, `category` defaults to `other`.
