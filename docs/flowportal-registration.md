# FlowPortal registration wizard (PRD-015)

Pre-account ESFA employer registration: five-step wizard with resume token, Companies House lookup, and completion email.

**PRD:** F4.2.2 · [05-flowportal.md](prd/05-flowportal.md)

All endpoints are **public** (no JWT). Sessions expire after **30 days**. Only a SHA-256 hash of the resume token is stored.

## Wizard steps

| Step | Key | Purpose |
|------|-----|---------|
| 1 | `company_verification` | Companies House number → name + address snapshot |
| 2 | `paye_reference` | PAYE ref (`123/AB45678`) |
| 3 | `das_account` | DAS account status capture (no live ESFA create in v1) |
| 4 | `bank_details` | Account name, sort code, account number |
| 5 | `consent` | Levy transfer + data processing consent, signatory name |

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/flowportal-registration/sessions` | Create session; returns `resumeToken` (once) + `sessionId` |
| GET | `/api/v1/flowportal-registration/sessions/by-token/:resumeToken` | Resume progress (bank account number redacted) |
| PUT | `/api/v1/flowportal-registration/sessions/by-token/:resumeToken/steps/:step` | Validate + save step; advance `currentStep` |
| POST | `/api/v1/flowportal-registration/sessions/by-token/:resumeToken/complete` | Require all steps + `contactEmail`; enqueue confirmation email |

### Create session

```http
POST /api/v1/flowportal-registration/sessions
Content-Type: application/json

{
  "contactEmail": "employer@example.com",
  "sector": "construction",
  "region": "north_west"
}
```

Optional `sector` / `region` pre-seed from the eligibility checker CTA.

### Save step example

```http
PUT /api/v1/flowportal-registration/sessions/by-token/{token}/steps/company_verification
Content-Type: application/json

{ "companiesHouseNumber": "12345678" }
```

## Companies House

| Env | Behaviour |
|-----|-----------|
| `COMPANIES_HOUSE_API_KEY` unset | Noop client (e2e/dev) — deterministic fake company |
| `COMPANIES_HOUSE_API_KEY` set | Live lookup via Companies House API |

Lookup failures return `422` with an actionable message.

## Email

Template: `flowportal-registration-complete` — enqueued on `complete` via `EmailDispatchService` (noop-safe in test when queue is mocked).

## Database

Table: `flowportal_registration_sessions` (migration `1781100000010`). **No RLS** — pre-account sessions keyed by resume token only.
