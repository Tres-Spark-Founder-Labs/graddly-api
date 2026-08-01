# Ofsted / EIF / QIP / Evidence Pack (Phase R)

Provider-portal Ofsted hub APIs: org-level EIF readiness scores, QIP action tracking, and async evidence-pack ZIP export.

**PRD:** [04-provider-portal.md](prd/04-provider-portal.md) — F2.1.1 (EIF scores), F2.1.2 (QIP), F2.1.4 (evidence pack).

All routes require `Authorization: Bearer <token>` and an active organisation (`X-Organisation-Id` optional override; see [auth tokens](auth-tokens.md)).

## Domain model

| Table / config | Purpose |
|----------------|---------|
| `src/ofsted/config/eif-criteria.v1.json` | Versioned catalogue of 7 EIF criterion slugs + labels (not tenant-scoped) |
| `qip_actions` | Quality Improvement Plan actions per organisation (RLS-scoped) |
| `safeguarding_checklist_items` | Org safeguarding checklist for EIF safeguarding criterion |
| `programme_documents` | Required EIF programme uploads per programme |
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

**v1 scoring:** live domain signals (OTJ pace, reviews, commitments, ILR validation, portfolio evidence, programme document coverage, safeguarding checklist completion).

| Metric key | Source |
|------------|--------|
| `programme_docs` | % of required document types filled across **active** programmes |
| `safeguarding` | % of org safeguarding checklist items marked complete |

### Safeguarding checklist

Auto-seeded on first access (4 items). Mark complete via PATCH.

```http
GET /api/v1/ofsted/safeguarding-checklist
PATCH /api/v1/ofsted/safeguarding-checklist/:slug
```

### Programme documents

One document per required type per programme (`curriculum_map`, `assessment_strategy`, `industry_engagement`).

```http
GET /api/v1/programmes/:programmeId/documents
POST /api/v1/programmes/:programmeId/documents
```

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

## EIF score trend (F2.1.1 AC5)

```http
GET /api/v1/ofsted/eif-scores/trend
→ {
    "data": {
      "criteria": [
        {
          "slug": "safeguarding",
          "label": "Safeguarding",
          "points": [{ "capturedOn": "2026-07-01", "percent": 72, "rag": "amber" }]
        }
      ],
      "overall": [{ "capturedOn": "2026-07-01", "percent": 68, "rag": "amber" }],
      "pointCount": 1,
      "hasTrendData": false,
      "earliestCapturedOn": "2026-07-01",
      "windowMonths": 12
    }
  }
```

One series per criterion plus `overall`, oldest point first, over a rolling
12-month window. Series come from the **criteria catalogue**, not from the
snapshots, so a criterion added part-way through the window still appears with
a shorter series instead of vanishing.

Built from `eif_score_snapshots`, **not** from the live score — scores are
computed on demand and cached for an hour, so nothing retained them before
this. It also cannot be back-filled: a score is a function of the OTJ logs,
reviews, evidence and documents *as they stood on a given day*.

`hasTrendData` is `false` below two captured days. One reading is a fact, not a
trend, and a line through a single point reads as *flat* rather than *we have
only just started recording*.

Capture runs nightly via `CRON_EIF_SNAPSHOT_ENABLED` (see Configuration), is
idempotent per organisation per day, and defaults **off** outside production
and staging — so no history accrues in an environment where nobody enabled it.

## QIP actions

Routes live at `/api/v1/qip-actions` (not under `/ofsted/`). Reads are open to any org member; writes are capability-guarded — see [Capabilities](#capabilities) below.

| Method | Path | Description | Capability |
|--------|------|-------------|------------|
| `POST` | `/api/v1/qip-actions` | Create action | `MANAGE_QIP` |
| `GET` | `/api/v1/qip-actions` | Paginated list (`status`, `eifCriterionSlug`, `overdue`) | — |
| `GET` | `/api/v1/qip-actions/summary` | Hub totals: `{ total, completed, overdue, percentComplete }` | — |
| `GET` | `/api/v1/qip-actions/:id` | Get one | — |
| `PATCH` | `/api/v1/qip-actions/:id` | Partial update (every field) | `MANAGE_QIP` |
| `PATCH` | `/api/v1/qip-actions/:id/progress` | Status, evidence notes and attachments only | `COMPLETE_QIP_ACTION` |
| `POST` | `/api/v1/qip-actions/export` | Queue the plan as a PDF; poll `GET /pdf/jobs/{jobId}` | `DOWNLOAD_EVIDENCE_PACK` |
| `DELETE` | `/api/v1/qip-actions/:id` | Soft delete (204) | `MANAGE_QIP` |

### Capabilities

Roles for each capability are defined in one place —
`src/auth/capabilities/capability-roles.ts` — because the client has not yet
confirmed how their five job titles map onto three permission levels. Current
defaults:

| Capability | Roles | Why |
|---|---|---|
| `MANAGE_QIP` | owner, admin | Deciding what the plan contains is a leadership act an inspector reads |
| `COMPLETE_QIP_ACTION` | owner, admin, **member** | The tutor who did the work is the right person to record it |
| `DOWNLOAD_EVIDENCE_PACK` | owner, admin, member | Being unable to produce the plan mid-inspection because the one admin is on leave is the worse failure |

`PATCH /:id/progress` exists so the wider capability can be granted safely: its
DTO holds only `status`, `evidenceNotes` and `evidenceAttachmentKeys`, and the
global validation pipe runs `forbidNonWhitelisted`, so a `title` sent to it is
a `400` rather than a silently ignored field.

### Export the plan (F2.1.2 AC5)

```http
POST /api/v1/qip-actions/export
→ 201 { "data": { "jobId": "…", "status": "queued" } }
```

Grouped by EIF criterion in catalogue order, progress stated first, owners
resolved to names (`Unassigned` when the user cannot be resolved). Attachments
are **counted, not embedded** — the documents themselves ship in the evidence
pack (F2.1.4), and duplicating them here would create two versions of the same
evidence. An empty plan still renders a document saying so.

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
| `CRON_EIF_SNAPSHOT_ENABLED` | `false` | Nightly EIF score capture. **No history accrues while this is off**, and it cannot be back-filled |
| `CRON_EIF_SNAPSHOT_SCHEDULE` | `0 2 * * *` | 02:00 daily |

See also [file-storage.md](./file-storage.md) for export upload settings (`STORAGE_PROVIDER`, S3).

## Deferred (out of Phase R scope)

- SAR auto-generation (F2.1.3)
- SAR export (the QIP half shipped — see `POST /api/v1/qip-actions/export`)
- Staging UI for custom documents (pass `additionalStorageKeys` on job create only)
