# ILR — Individualised Learner Record (Phase Q)

Builds monthly ILR learner rows from enrolment data using a **versioned mapping config**, validates against config-driven rules with plain-English reports, and submits to a configurable ESFA client (noop by default) via **async BullMQ**.

## Domain model

| Table | Purpose |
|-------|---------|
| `ilr_mapping_configs` | Platform-wide versioned field/rule definitions (not tenant-scoped) |
| `ilr_learner_records` | One row per enrolment + `collectionPeriod` (`YYYY-MM`) |
| `ilr_submissions` | Submit/amend attempts with ESFA receipt storage |

## Status workflows

**Learner record:** `draft` → `validated` | `validation_failed` (patch overrides resets to `draft`)

**Submission:** `queued` → `processing` → `submitted` | `failed`

POST submit/amend returns **201** with `status: queued`. Poll `GET /api/v1/ilr/submissions/:id` until terminal status.

## Async submit flow

1. API creates `ilr_submissions` row (`queued`) and enqueues `ilr-submit` BullMQ job (`jobId = submissionId`).
2. Worker sets `processing`, builds **ILR XML** from field map, calls ESFA client.
3. On success: `submitted` + receipt + in-app notification.
4. On terminal failure: `failed` + notification + dead-letter on `ilr-submit-dlq`.

## APIs

### Mapping configs

| Method | Path |
|--------|------|
| `GET` | `/api/v1/ilr/mapping-configs` |
| `GET` | `/api/v1/ilr/mapping-configs/active?academicYear=` |
| `POST` | `/api/v1/ilr/mapping-configs` (owner/admin, `ILR_CONFIG_WRITE_ENABLED=true`) |
| `POST` | `/api/v1/ilr/mapping-configs/:id/publish` |

### Learner records

| Method | Path |
|--------|------|
| `POST` | `/api/v1/ilr/learner-records/build` |
| `GET` | `/api/v1/ilr/learner-records` |
| `GET` | `/api/v1/ilr/learner-records/:id` |
| `PATCH` | `/api/v1/ilr/learner-records/:id` |
| `POST` | `/api/v1/ilr/learner-records/:id/validate` |
| `GET` | `/api/v1/ilr/learner-records/:id/validation-report` |
| `POST` | `/api/v1/ilr/learner-records/:id/submit` (owner/admin, returns `queued`) |
| `POST` | `/api/v1/ilr/learner-records/:id/amend` (owner/admin, returns `queued`) |
| `GET` | `/api/v1/ilr/learner-records/:id/submissions` |

### Submissions

| Method | Path |
|--------|------|
| `GET` | `/api/v1/ilr/submissions/:id` (poll for receipt) |

## Environment

| Variable | Default | Notes |
|----------|---------|-------|
| `ILR_ESFA_PROVIDER` | `noop` | `http` for OAuth REST stub |
| `ILR_ESFA_BASE_URL` | — | Required when provider is `http` |
| `ILR_ESFA_TOKEN_URL` | — | OAuth token endpoint |
| `ILR_ESFA_CLIENT_ID` / `ILR_ESFA_CLIENT_SECRET` / `ILR_ESFA_SCOPE` | — | Client credentials |
| `ILR_ESFA_SUBMIT_PATH` | `/api/v1/ilr/submit` | POST path |
| `ILR_ESFA_TIMEOUT_MS` | `15000` | Request timeout |
| `ILR_ESFA_PAYLOAD_FORMAT` | `xml` | `json` \| `xml` wire format when provider is `http` |
| `ILR_CONFIG_WRITE_ENABLED` | `false` | Allow publishing new mapping config drafts |

## v1 limitations and roadmap

- **Mapping config** seeds a minimal apprenticeship field subset for `2025-26` v1 — not the full ESFA specification. Annual updates = new published mapping config versions.
- **Validation** runs config JSON rules only. Full ESFA rule spreadsheets and online-only checks (ULN, postcode) are future work.
- **XML** covers the v1 seeded field subset only — not full annual ESFA XSD.
- **Submit** uses configurable REST client; official Submit Learner Data portal automation is future work.
- **Domain gaps:** `Apprentice` lacks ULN/DOB/etc. — use `manualOverrides` on learner records until domain entities grow.

## Testing and mocks

Three layers (see `test/ilr.e2e-spec.ts` and `src/ilr/testing/`):

1. **E2E default — `ILR_ESFA_PROVIDER=noop`:** queue + `processIlrSubmitJobInApp` helper → deterministic `NOOP-*` references.
2. **E2E spy:** mock `ILR_ESFA_CLIENT.submit` for failure paths (terminal attempt).
3. **Unit HTTP:** `jest.spyOn(global, 'fetch')` + mocked OAuth in `ilr-esfa-http.client.spec.ts` (XML body).

Fixtures: `test/fixtures/ilr/`, seed helper `test/helpers/ilr-seed.ts`.

**Note:** Noop receipt JSON is for tests/local dev — not a contract of real ESFA responses.
