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

| Field                   | Description                                                          |
| ----------------------- | -------------------------------------------------------------------- |
| `status`                | `eligible` \| `not_eligible` \| `check_with_advisor`                 |
| `estimatedFundingBand`  | `{ min, max, currency }` from `eligibility-rules.v1.json`            |
| `nextSteps`             | Actionable strings for the UI                                        |
| `beginRegistrationPath` | Present when `eligible` — `/api/v1/flowportal-registration/sessions` |

Rules: `src/levy-exchange/config/eligibility-rules.v1.json`. Existing DAS account → `check_with_advisor`.

## Module overview

| Slice   | Feature                             | Key tables                                                                        |
| ------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| LEX-001 | Donor DAS link + OAuth consent      | `das_donor_links`, `das_donor_oauth_tokens`                                       |
| LEX-002 | Surplus + expiry alerts             | `das_levy_tranches`, `levy_surplus_snapshots`, `levy_expiry_alert_dispatches`     |
| LEX-003 | Rule-based matching v1              | `levy_recipient_profiles`, `levy_transfer_preferences`, `levy_match_applications` |
| LEX-004 | Transfer docs + e-sign + DAS create | `levy_transfers`, `levy_transfer_documents`, `levy_transfer_signatures`           |

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

| Criterion          | Weight |
| ------------------ | ------ |
| Sector alignment   | 30%    |
| Regional proximity | 25%    |
| Programme type     | 25%    |
| Amount fit         | 20%    |

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

```
POST /api/v1/levy-exchange/transfers                  donor, from a confirmed match
POST /api/v1/levy-exchange/transfers/{id}/sign        { "party": "donor" | "recipient", "signatureImageKey": "orgs/.../signature.png" }
POST /api/v1/levy-exchange/transfers/{id}/submit      donor, once both parties have signed
GET  /api/v1/levy-exchange/transfers[?role=donor|recipient]
GET  /api/v1/levy-exchange/transfers/{id}
GET  /api/v1/levy-exchange/transfers/{id}/document
POST /api/v1/levy-exchange/transfers/{id}/enrolments  the enrolment's owner, normally the provider
```

The agreement PDF (`levy_transfer_agreement`) is generated when the transfer is
created. When it completes, the transfer opens for signing and the document
becomes `ready` with the unsigned PDF, so both parties can read it before
anyone signs. The donor signs first, then the recipient; the recipient's
signature moves the transfer to `pending_esfa`, and the donor submits to DAS
(`createLevyTransferConsent`). A daily cron syncs status from ESFA.

### Who is asked to sign

Every transfer carries `signatures` (both slots, in order), `nextParty` and
`actionRequired`. `actionRequired` is true only when the requesting user's
party is next **and** they may sign for it — its assigned signer, or an owner
or admin. That is the same rule the sign endpoint enforces
(`mayUserSignSlot`, `levy-transfer-signing-state.ts`), so the two cannot
disagree. Do not read `status === pending_signatures` as "your turn": it is
true for both parties while the donor has not signed.

### The document, for both parties

One document row per transfer, owned by the donor and readable by the
recipient. Once both have signed, `GET /document` returns each party's own
lasting copy — the donor's in the donor's storage (`signedStorageKey`), the
recipient's in the recipient's (`recipientSignedStorageKey`), per F4.2.4 AC3.
Before that, both get the unsigned agreement. Transfers completed before
migration `1781100000055` have no recipient copy; the recipient is served the
donor's.

### Access model: every transfer route runs under RLS

Until migration `1781100000055`, `rls-bootstrap.middleware.ts` turned RLS off
for every POST under `/levy-exchange/transfers`, and the recipient could not
read its own agreement at all (GETs were never bypassed, and the document
policy was owner-only). What crosses the tenant line now, and how:

| Crossing                                                      | Granted by                                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The recipient reads the agreement                             | `levy_transfer_documents_select_recipient`                                                                                            |
| The recipient's final signature closes it, `ready` → `signed` | `levy_transfer_documents_update_recipient_completes`, with the restrictive `levy_transfer_documents_owner_is_donor` pinning ownership |
| Both parties see both signature slots                         | `levy_transfer_signatures_select_party`                                                                                               |
| The donor creates the recipient's empty slot                  | `levy_transfer_signatures_insert_recipient_slot`                                                                                      |
| The donor reads the recipient's UKPRN for ESFA                | A narrow `setRlsBootstrap` window in `submitToDas`, `select: ['ukprn']`, after the caller is confirmed as the donor                   |
| The enrolment's owner reads a transfer to link a learner      | A narrow `setRlsBootstrap` window in `link`, four named columns, after the caller is authorised on the enrolment it owns              |

`test/levy-exchange/transfers.e2e-spec.ts` runs the whole lifecycle as the
application role, asserts that role is neither superuser nor BYPASSRLS, and
clears process-global tenant state before every request, so a pass cannot come
from another request's organisation.

No transfer route is exempt from RLS: `rls-bootstrap.middleware.ts` matches
none of them, and its spec fails if the list grows or if an entry stops being
an anchored, two-segment suffix. The two reads that cross the tenant line do it
one named read at a time, under the rule recorded on `setRlsBootstrap` and in
`docs/employer-learner-access.md`, "Bootstrap is for named, narrow reads".

## Crons (worker)

| Cron                 | Env flag                            | Default schedule |
| -------------------- | ----------------------------------- | ---------------- |
| Levy expiry alerts   | `CRON_LEVY_EXPIRY_ALERTS_ENABLED`   | `0 8 * * *`      |
| Transfer status sync | `CRON_LEVY_TRANSFER_STATUS_ENABLED` | `0 3 * * *`      |

## Swagger

All endpoints documented under **Levy Exchange** in Swagger UI (`/api/docs` when enabled).

## Migrations

Run after deploy:

```bash
yarn migration:run
```

Creates migrations `1780500000000` through `1780500000005`.
