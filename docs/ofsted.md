# Ofsted / EIF / QIP / Evidence Pack (Phase R)

Provider-portal Ofsted hub APIs: org-level EIF readiness scores, QIP action tracking, and async evidence-pack ZIP export.

**PRD:** [04-provider-portal.md](prd/04-provider-portal.md) — F2.1.1 (EIF scores), F2.1.2 (QIP), F2.1.4 (evidence pack).

All routes require `Authorization: Bearer <token>` and an active organisation (`X-Organisation-Id` optional override; see [auth tokens](auth-tokens.md)).

## Domain model

| Table / config | Purpose |
|----------------|---------|
| `src/ofsted/config/eif-criteria.v1.json` | Versioned catalogue of 7 EIF criterion slugs + labels (not tenant-scoped) |
| `qip_actions` | Quality Improvement Plan actions per organisation (RLS-scoped) |
| `evidence_pack_jobs` | Async ZIP export jobs per organisation |

### EIF criterion slugs (v1)

| Slug | Label |
|------|-------|
| `curriculum_intent` | Curriculum intent |
| `curriculum_implementation` | Curriculum implementation |
| `curriculum_impact` | Curriculum impact |
| `behaviour_attitudes` | Behaviour and attitudes |
| `personal_development` | Personal development |
| `leadership_management` | Leadership and management |
| `safeguarding` | Safeguarding |

Use `GET /api/v1/ofsted/eif-criteria` for the live list (preferred over hard-coding).

## QIP status workflow

Stored statuses: `not_started` → `in_progress` → `completed`.

**Overdue** is not stored; it is derived on read when `targetCompletionDate < today` and status ≠ `completed`. List endpoints sort overdue items first.

## Evidence pack job workflow

```
queued → processing → completed
                   ↘ failed
```

Poll `GET /api/v1/ofsted/evidence-packs/:id` until `status` is `completed` or `failed`. When completed, the response includes `downloadUrl` (presigned) and `manifest` (file counts per theme folder).

Jobs run on the BullMQ `evidence-pack` queue in the **worker** process (`yarn start:worker` or combined `yarn start`).

## EIF readiness scores

**RAG thresholds:** red &lt; 60%, amber 60–79%, green ≥ 80%. `alertBanner` is `true` when **any** criterion is below 75%.

**Cache:** Redis key `eif:scores:{organisationId}` with TTL `EIF_SCORE_CACHE_TTL_SECONDS` (default `3600`; `0` disables caching). Response field `cached: true` on cache hits. Invalidated when OTJ approve/reject, review completion, commitment fully signed, ILR validate, or KSB evidence accept changes underlying data.

**v1 scoring:** stub weighting from live domain signals (OTJ pace, reviews, commitments, ILR validation, portfolio evidence, programme count). Safeguarding and programme-doc criteria use placeholder constants until dedicated modules exist.

### List EIF criteria

```http
GET /api/v1/ofsted/eif-criteria
Authorization: Bearer <token>
X-Organisation-Id: <org-uuid>
```

### Get EIF scores

```http
GET /api/v1/ofsted/eif-scores
Authorization: Bearer <token>
X-Organisation-Id: <org-uuid>
```

Example response shape:

```json
{
  "message": "EIF readiness scores retrieved successfully",
  "data": {
    "overallPercent": 72,
    "overallRag": "amber",
    "alertBanner": true,
    "criteria": [
      {
        "slug": "safeguarding",
        "label": "Safeguarding",
        "percent": 70,
        "rag": "amber"
      }
    ],
    "calculatedAt": "2026-05-28T12:00:00.000Z",
    "cached": false
  }
}
```

## QIP actions

Routes live at `/api/v1/qip-actions` (not under `/ofsted/`). Any org member with a valid token may CRUD actions in the active organisation.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/qip-actions` | Create action |
| `GET` | `/api/v1/qip-actions` | Paginated list (`status`, `eifCriterionSlug`, `overdue`) |
| `GET` | `/api/v1/qip-actions/summary` | Hub totals: `{ total, completed, overdue, percentComplete }` |
| `GET` | `/api/v1/qip-actions/:id` | Get one |
| `PATCH` | `/api/v1/qip-actions/:id` | Partial update |
| `DELETE` | `/api/v1/qip-actions/:id` | Soft delete (204) |

### Create QIP action

```http
POST /api/v1/qip-actions
Content-Type: application/json

{
  "title": "Improve safeguarding records",
  "assignedOwnerUserId": "<staff-user-uuid>",
  "targetCompletionDate": "2026-12-31",
  "eifCriterionSlug": "safeguarding",
  "description": "Optional longer text",
  "evidenceNotes": "Optional evidence notes",
  "evidenceAttachmentKeys": ["orgs/<orgId>/…"],
  "status": "not_started"
}
```

**Errors:**

| HTTP | When |
|------|------|
| 422 | Validation failed (missing title, bad date format, etc.) |
| 400 | Invalid `eifCriterionSlug`, owner not an org member, or invalid storage key |
| 404 | `:id` not found (get/patch/delete) |

## Evidence pack (async ZIP)

**Roles:** `owner` or `admin` only.

| Method | Path |
|--------|------|
| `POST` | `/api/v1/ofsted/evidence-packs` |
| `GET` | `/api/v1/ofsted/evidence-packs/:id` |

### Queue a pack

```http
POST /api/v1/ofsted/evidence-packs
Content-Type: application/json

{
  "additionalStorageKeys": []
}
```

Optional `additionalStorageKeys` must be org-scoped storage keys; invalid keys return **400**.

### Poll until ready

```http
GET /api/v1/ofsted/evidence-packs/<jobId>
```

When `status` is `completed`, download via `downloadUrl` before `downloadExpiresAt`.

### ZIP layout

One folder per EIF theme slug, for example:

```
behaviour_attitudes/otj-summary.csv
personal_development/reviews/…
leadership_management/commitments/…
curriculum_impact/ilr/…
curriculum_implementation/portfolio-evidence/…
<safeguarding>/qip-evidence/…   # completed QIP actions by criterion slug
custom/…                        # from additionalStorageKeys
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `EIF_SCORE_CACHE_TTL_SECONDS` | `3600` | Redis TTL for EIF scores (`0` = no cache) |

See also [file-storage.md](./file-storage.md) for export upload settings (`STORAGE_PROVIDER`, S3).

## Deferred (out of Phase R scope)

- SAR auto-generation (F2.1.3)
- QIP / SAR PDF export
- 12-month EIF trend charts (snapshots + cron)
- Staging UI for custom documents (pass `additionalStorageKeys` on job create only)
