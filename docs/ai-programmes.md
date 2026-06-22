# FlowPortal AI programmes (PRD-016)

FlowPortal Module C — catalogue, enrolment, and per-module progress for `flowportal_ai` apprenticeship programmes.

**PRD:** F4.4.1–F4.4.3 · [05-flowportal.md](prd/05-flowportal.md)

All endpoints require **JWT**, active **Flow** portal organisation (`X-Organisation-Id`), and Swagger tag **AI Programmes**.

## Data model

| Piece | Notes |
|-------|--------|
| `programmes.deliveryType` | `employer_led` (default) or `flowportal_ai` |
| `ai_programme_modules` | Curriculum outline per programme (slug, title, sort order) |
| `ai_programme_progress` | Per enrolment + module: `not_started` / `in_progress` / `completed` |
| `ai_programme_completions` | Programme completion record when all modules are done |

Catalogue programmes are seeded under platform provider org slug `flowportal-ai-provider` (migration `1781100000011`). Cross-org catalogue reads use RLS bootstrap (same pattern as employer directory).

Enrolments are created on the **Flow SME org** with `providerOrganisationId` set to the seeded AI provider.

## Endpoints

| Method | Path | PRD | Description |
|--------|------|-----|-------------|
| GET | `/api/v1/ai-programmes/catalogue` | F4.4.1 | List active AI programmes with module counts |
| GET | `/api/v1/ai-programmes/catalogue/:programmeId` | F4.4.1 | Programme detail + ordered module outline |
| POST | `/api/v1/ai-programmes/enrolments` | F4.4.2 | Enrol apprentice on AI track; activate + init progress rows |
| GET | `/api/v1/ai-programmes/enrolments/:enrolmentId/progress` | F4.4.3 | Module statuses and `percentComplete` |
| POST | `/api/v1/ai-programmes/enrolments/:enrolmentId/progress` | F4.4.3 | Upsert module progress (`moduleSlug`, `status`, optional `metadata`) |
| POST | `/api/v1/ai-programmes/enrolments/:enrolmentId/complete` | F4.4.3 | Complete programme when all modules are `completed` (idempotent) |

Non-Flow portal organisations receive **403**.

### Enrol example

```http
POST /api/v1/ai-programmes/enrolments
Authorization: Bearer …
X-Organisation-Id: {flow-org-uuid}
Content-Type: application/json

{
  "programmeId": "a2222222-2222-4222-8222-222222222201",
  "firstName": "Alex",
  "lastName": "Apprentice",
  "email": "alex@example.com",
  "plannedStartDate": "2026-09-01"
}
```

Use `apprenticeId` instead of identity fields when the apprentice already exists on the Flow org.

### Progress example

```http
POST /api/v1/ai-programmes/enrolments/{enrolmentId}/progress
Content-Type: application/json

{ "moduleSlug": "foundations", "status": "completed" }
```

## Tests

- Unit: `src/ai-programmes/*.service.spec.ts`
- E2E: `test/ai-programmes/*.e2e-spec.ts` (reuses `createFlowSmeContext`)
- E2E global setup re-seeds catalogue via `test/helpers/ai-programme-seed.ts` after DB truncate

## Out of scope (v1)

- F4.4.4 applied project submission, F4.4.5 async learning modules (Phase 2)
- Catalogue admin/write API (seed + migration only)
