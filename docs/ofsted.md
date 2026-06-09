# Ofsted / EIF / QIP / Evidence Pack (Phase R)

Provider-portal Ofsted hub APIs: org-level EIF readiness scores, QIP action tracking, and async evidence-pack ZIP export.

**PRD:** [04-provider-portal.md](prd/04-provider-portal.md) — F2.1.1 (EIF scores), F2.1.2 (QIP), F2.1.4 (evidence pack).

## EIF readiness scores

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/ofsted/eif-criteria` | Published list of 7 EIF criterion slugs + labels (from `src/ofsted/config/eif-criteria.v1.json`) |
| `GET /api/v1/ofsted/eif-scores` | Org-level scores: overall %, per-criterion %, RAG, `alertBanner`, `calculatedAt`, `cached` |

**RAG thresholds:** red &lt; 60%, amber 60–79%, green ≥ 80%. `alertBanner` is `true` when any criterion is below 75%.

**Cache:** Redis key `eif:scores:{organisationId}` with TTL `EIF_SCORE_CACHE_TTL_SECONDS` (default `3600`; `0` disables caching). Invalidated when OTJ approve/reject, review completion, commitment fully signed, ILR validate, or KSB evidence accept changes underlying data.

**v1 scoring:** stub weighting from live domain signals (OTJ pace, reviews, commitments, ILR validation, portfolio evidence, programme count). Safeguarding and programme-doc criteria use placeholder constants until dedicated modules exist.

## QIP actions

| Method | Path |
|--------|------|
| `POST` | `/api/v1/qip-actions` |
| `GET` | `/api/v1/qip-actions` (paginated; `status`, `eifCriterionSlug`, `overdue`) |
| `GET` | `/api/v1/qip-actions/summary` |
| `GET` | `/api/v1/qip-actions/:id` |
| `PATCH` | `/api/v1/qip-actions/:id` |
| `DELETE` | `/api/v1/qip-actions/:id` (soft delete, 204) |

`isOverdue` is derived on read when `targetCompletionDate` is before today and status is not `completed`. List sorts overdue items first.

## Evidence pack (async ZIP)

| Method | Path | Roles |
|--------|------|-------|
| `POST` | `/api/v1/ofsted/evidence-packs` | `owner`, `admin` |
| `GET` | `/api/v1/ofsted/evidence-packs/:id` | `owner`, `admin` |

Body: `{ "additionalStorageKeys": ["…"] }` (optional org-scoped storage keys merged under `custom/`).

BullMQ queue: `evidence-pack`. Poll `GET …/:id` until `status` is `completed` or `failed`; completed jobs include a presigned `downloadUrl`.

ZIP layout: one folder per EIF theme slug with OTJ CSV, reviews, commitments, ILR JSON, portfolio evidence, QIP attachments, and optional custom files.

## Configuration

```env
EIF_SCORE_CACHE_TTL_SECONDS=3600
```

## Deferred (out of Phase R scope)

- SAR auto-generation (F2.1.3)
- QIP / SAR PDF export
- 12-month EIF trend charts (snapshots + cron)
- Staging UI for custom documents (API accepts `additionalStorageKeys` on job create only)
