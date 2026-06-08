# ILR — Individualised Learner Record (Phase Q)

Builds monthly ILR learner rows from enrolment data using a **versioned mapping config**, validates against config-driven rules with plain-English reports, and submits to a configurable ESFA REST client (noop by default).

## Domain model

| Table | Purpose |
|-------|---------|
| `ilr_mapping_configs` | Platform-wide versioned field/rule definitions (not tenant-scoped) |
| `ilr_learner_records` | One row per enrolment + `collectionPeriod` (`YYYY-MM`) |
| `ilr_submissions` | Submit/amend attempts with ESFA receipt storage |

## Status workflows

**Learner record:** `draft` → `validated` | `validation_failed` (patch overrides resets to `draft`)

**Submission:** `processing` → `submitted` | `failed`

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
| `POST` | `/api/v1/ilr/learner-records/:id/submit` (owner/admin) |
| `POST` | `/api/v1/ilr/learner-records/:id/amend` (owner/admin) |
| `GET` | `/api/v1/ilr/learner-records/:id/submissions` |

### Submissions

| Method | Path |
|--------|------|
| `GET` | `/api/v1/ilr/submissions/:id` |

## Environment

| Variable | Default | Notes |
|----------|---------|-------|
| `ILR_ESFA_PROVIDER` | `noop` | `http` for OAuth REST stub |
| `ILR_ESFA_BASE_URL` | — | Required when provider is `http` |
| `ILR_ESFA_TOKEN_URL` | — | OAuth token endpoint |
| `ILR_ESFA_CLIENT_ID` / `ILR_ESFA_CLIENT_SECRET` / `ILR_ESFA_SCOPE` | — | Client credentials |
| `ILR_ESFA_SUBMIT_PATH` | `/api/v1/ilr/submit` | POST path |
| `ILR_ESFA_TIMEOUT_MS` | `15000` | Request timeout |
| `ILR_CONFIG_WRITE_ENABLED` | `false` | Allow publishing new mapping config drafts |

## v1 limitations and roadmap

- **Mapping config** seeds a minimal apprenticeship field subset for `2025-26` v1 — not the full ESFA specification. Annual updates = new published config versions.
- **Validation** runs config JSON rules only. Full ESFA rule spreadsheets and online-only checks (ULN, postcode) are future work.
- **Submit** uses a REST client stub. Official ILR is XML via Submit Learner Data; XML generation can plug in behind `IIlrEsfaClient` later.
- **Domain gaps:** `Apprentice` lacks ULN/DOB/etc. — use `manualOverrides` on learner records until domain entities grow.
- **Async submit:** v1 is synchronous; BullMQ `ilr-submit` queue + retries may follow (see withdrawal-push pattern).

## Testing and mocks

Three layers (see `test/ilr.e2e-spec.ts` and `src/ilr/testing/`):

1. **E2E default — `ILR_ESFA_PROVIDER=noop`:** `IlrEsfaNoopClient` returns deterministic `NOOP-*` references. No network.
2. **E2E spy:** `jest.spyOn(app.get(ILR_ESFA_CLIENT), 'submit')` to simulate failures (notifications test).
3. **Unit HTTP:** `jest.spyOn(global, 'fetch')` + mocked `IlrEsfaOAuthService` in `ilr-esfa-http.client.spec.ts`.

Fixtures: `test/fixtures/ilr/`, seed helper `test/helpers/ilr-seed.ts`.

**Note:** Noop receipt JSON is for tests/local dev — not a contract of real ESFA responses.
