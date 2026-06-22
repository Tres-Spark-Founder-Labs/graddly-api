# Levy Exchange (Phase S / FlowPortal Module A)

FlowPortal levy marketplace backend: donor DAS linking, surplus calculator, rule-based SME matching, transfer compliance docs, and ESFA transfer consent.

**PRD:** [05-flowportal.md](prd/05-flowportal.md) — F4.1.1–F4.2.4.

All authenticated routes require `Authorization: Bearer <token>` and an active organisation (`X-Organisation-Id` optional override).

## Anonymous eligibility check (F4.2.1)

No authentication required. Rate-limited public endpoint for prospective SME employers.

```http
POST /api/v1/levy-exchange/eligibility/check
Content-Type: application/json

{
  "employeeCountBand": "10_49",
  "sector": "construction",
  "region": "north_west",
  "hasDasAccount": false
}
```

**Response `data`:**

| Field | Description |
|-------|-------------|
| `status` | `eligible` \| `not_eligible` \| `check_with_advisor` |
| `estimatedFundingBand` | `{ min, max, currency }` from `eligibility-rules.v1.json` |
| `nextSteps` | Actionable strings for the UI |
| `beginRegistrationPath` | Present when `eligible` — `/api/v1/flowportal-registration/sessions` |

Rules: `src/levy-exchange/config/eligibility-rules.v1.json`. Existing DAS account → `check_with_advisor`.

## Module overview

| Slice | Feature | Key tables |
|-------|---------|------------|
| LEX-001 | Donor DAS link + OAuth consent | `das_donor_links`, `das_donor_oauth_tokens` |
| LEX-002 | Surplus + expiry alerts | `das_levy_tranches`, `levy_surplus_snapshots`, `levy_expiry_alert_dispatches` |
| LEX-003 | Rule-based matching v1 | `levy_recipient_profiles`, `levy_transfer_preferences`, `levy_match_applications` |
| LEX-004 | Transfer docs + e-sign + DAS create | `levy_transfers`, `levy_transfer_documents`, `levy_transfer_signatures` |

## Donor DAS linking (F4.1.1)

Donors link ESFA DAS accounts via **OAuth 2.0 authorization code** — no credentials stored. Tokens are encrypted at rest.

**Link status:** `pending_consent` → `linked` (or `error` with resolution message).

```http
POST /api/v1/levy-exchange/donor-links
Authorization: Bearer <token>
X-Organisation-Id: <donor-org-uuid>
Content-Type: application/json

{ "label": "Group HQ", "ukprn": "12345678" }
```

Start consent (returns authorize URL):

```http
GET /api/v1/levy-exchange/donor-links/{id}/consent/start
```

Public callback (ESFA redirect):

```http
GET /api/v1/levy-exchange/donor-links/oauth/callback?code=...&state=...
```

On-demand sync using donor token:

```http
POST /api/v1/levy-exchange/donor-links/{id}/sync
```

**Env:** `DAS_DONOR_OAUTH_*`, `DAS_DONOR_TOKEN_ENCRYPTION_KEY` (falls back to `JWT_SECRET`).

## Surplus calculator & expiry (F4.1.2)

Requires at least one **linked** donor DAS account.

```http
GET /api/v1/levy-exchange/surplus
GET /api/v1/levy-exchange/surplus/expiry-calendar
POST /api/v1/levy-exchange/surplus/recompute
```

Surplus fields:

- `totalBalance` — from DAS sync
- `committedToOwnApprenticeships` — forecast from active enrolments
- `maxTransferable` — up to **50%** of balance (PRD cap)
- `alreadyTransferred` — sum of confirmed transfers
- `availableSurplus` — transferable headroom

**Expiry alerts:** daily cron sends email + in-app notification at **90** and **30** days before tranche expiry.

Enable: `CRON_LEVY_EXPIRY_ALERTS_ENABLED=true` (worker process).

## Matching (F4.2.3)

Rule-based v1 (no ML). Weights in `src/levy-exchange/config/matching-rules.v1.json`:

| Criterion | Weight |
|-----------|--------|
| Sector alignment | 30% |
| Regional proximity | 25% |
| Programme type | 25% |
| Amount fit | 20% |

**SME profile:**

```http
PUT /api/v1/levy-exchange/recipient-profile
Content-Type: application/json

{
  "sector": "digital",
  "region": "north_west",
  "employeeCountBand": "10_49",
  "programmeType": "software_developer",
  "transferAmountRequired": "15000.00",
  "hasDasAccount": true
}
```

**Donor preferences (F4.1.3 minimal):**

```http
PUT /api/v1/levy-exchange/transfer-preferences
```

**Search matches:**

```http
POST /api/v1/levy-exchange/matches/search
```

**Applications:**

```http
POST /api/v1/levy-exchange/match-applications
PATCH /api/v1/levy-exchange/match-applications/{id}
GET /api/v1/levy-exchange/match-applications
```

Phase 1 MVP may run matching in **assisted mode** ([09-release-phases.md](prd/09-release-phases.md)); the API supports ranked results and donor confirm/reject.

## Transfers (F4.2.4)

Pipeline: `draft` → `pending_signatures` → `pending_esfa` → `confirmed` / `active` / `failed`

```http
POST /api/v1/levy-exchange/transfers
{ "matchApplicationId": "<confirmed-application-uuid>", "startDate": "2026-06-01" }

POST /api/v1/levy-exchange/transfers/{id}/sign
{ "party": "donor", "signatureImageKey": "orgs/.../signature.png" }

POST /api/v1/levy-exchange/transfers/{id}/submit
GET /api/v1/levy-exchange/transfers/{id}/document
```

On both parties signed, donor submits to DAS (`createLevyTransferConsent`). Daily cron syncs transfer status from ESFA.

PDF template: `levy_transfer_agreement`.

## Crons (worker)

| Cron | Env flag | Default schedule |
|------|----------|------------------|
| Levy expiry alerts | `CRON_LEVY_EXPIRY_ALERTS_ENABLED` | `0 8 * * *` |
| Transfer status sync | `CRON_LEVY_TRANSFER_STATUS_ENABLED` | `0 3 * * *` |

## Swagger

All endpoints documented under **Levy Exchange** in Swagger UI (`/api/docs` when enabled).

## Migrations

Run after deploy:

```bash
yarn migration:run
```

Creates migrations `1780500000000` through `1780500000005`.
