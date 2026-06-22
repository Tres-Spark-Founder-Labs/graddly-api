# DAS funding payment sync (PRD-013)

Daily batch sync of DAS funding payment confirmations into `das_funding_payments`, exposed on employer DAS APIs and reporting summaries.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DAS_FUNDING_PAYMENTS_PATH` | `/api/funding/payments` | DAS HTTP path for payment list |
| `CRON_DAS_FUNDING_SYNC_ENABLED` | `false` | Enable daily funding sync cron |
| `CRON_DAS_FUNDING_SYNC_SCHEDULE` | `0 2 * * *` | Cron expression (02:00 UTC) |

Funding sync reuses the existing `das-sync` BullMQ queue with job name `sync-funding-payments`.

## Sync flow

1. `DasFundingSyncCronService` scans organisations with a UKPRN (same query as levy sync).
2. Each org is enqueued via `DasSyncDispatchService.enqueueFundingSync`.
3. `DasSyncProcessor` calls `DasFundingSyncService.syncOrganisation`.
4. `DasHttpClient.fetchFundingPayments(ukprn)` returns tolerant JSON rows.
5. Rows upsert on `(organisationId, externalReference)`; optional `enrolmentId` match via apprentice email or enrolment id.

## Persistence

| Column | Notes |
|---|---|
| `paymentDate` | ISO date from DAS |
| `amount` / `currency` | Payment value |
| `fundingPeriod` | e.g. `2025-26` |
| `clawbackNotice` | Non-null when clawback pending |
| `externalReference` | DAS reference (unique per org) |
| `rawPayload` | Full DAS row + `requestedByUserId` |

RLS policies scope rows to the owning organisation (same pattern as `das_levy_balances`).

## Read APIs

| Method | Path | Portal | Description |
|---|---|---|---|
| GET | `/api/v1/das/funding-payments` | Any org member | Paginated list; optional `from` / `to` date filters |

Reporting surfaces:

- `fundingSummary` on `GET /api/v1/reporting/levy-roi` — `totalReceived`, `lastPaymentDate`, `pendingClawbackCount`
- `fundingClaimStatus` on `GET /api/v1/reporting/sme-overview` — `synced` / `no_payments` / `clawback_pending`

## Tests

```bash
yarn test das-funding-sync
yarn test:e2e test/das-funding-sync.e2e-spec.ts
```
