# Reporting (RPT-001 + RPT-002)

Levy ROI JSON + PDF export for employer portals, and a paginated employer directory for provider portals.

## Enrolment organisation links

Cross-portal reporting relies on counterpart org IDs on each enrolment:

| Field | Meaning |
|---|---|
| `organisationId` | Org that **owns** the enrolment record (employer org on employer-owned records; provider org on delivery records) |
| `employerOrganisationId` | Linked employer org for directory / ROI breakdown |
| `providerOrganisationId` | Linked training provider org for ROI breakdown |

### API

`PATCH /api/v1/enrolments/:id/organisation-links`

```json
{
  "employerOrganisationId": "uuid",
  "providerOrganisationId": "uuid"
}
```

Both fields are optional; send `null` to clear a link.

## Portal requirements

| Endpoint prefix | Required `portalType` on active org |
|---|---|
| `/api/v1/reporting/levy-roi` | `employer` |
| `/api/v1/reporting/levy-utilisation` | `employer` |
| `/api/v1/reporting/employer-directory` | `provider` |
| `/api/v1/reporting/sme-overview` | `flow` |

Requests from other portal types receive `403 Forbidden`.

## RPT-001 — Levy ROI report

PRD: F1.4.1, F1.1.5

### Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/reporting/levy-roi` | Full ROI summary JSON |
| GET | `/api/v1/reporting/levy-roi/breakdown?groupBy=provider\|standard` | Side-by-side breakdown |
| POST | `/api/v1/reporting/levy-roi/export` | Queue async PDF (`levy_roi_report` template) |

Poll PDF jobs via `GET /api/v1/pdf/jobs/:jobId` (same flow as other PDF exports).

### Metrics

| Field | Source | Notes |
|---|---|---|
| `totalLevySpendToDate` | DAS balance + confirmed/active outbound transfers | v1 spend **proxy** until contribution history exists |
| `availableBalance` | `DasLevySyncService.getLatestForOrganisation` | Latest synced DAS balance |
| `utilisationPercent` | Annualised forecast spend vs balance + annualised spend | Derived |
| `forecast.*` | `DasLevyForecastService` | Active enrolments, monthly spend, runway |
| `surplusSummary` | `LevySurplusService.getSurplus` | Empty when no donor links |
| `activeApprenticeCount` / `completionCount` | Enrolments on active org | Status filters |
| `averageCostPerCompletion` | Mean `agreedPrice` on completed enrolments | |
| `epaPassRate` | **null** | Stub until EPA entity exists |
| `estimatedProductivityUplift` | `completionCount × 5000` | v1 estimate (GBP) |
| `monthlyContributions` | `das_levy_monthly_entries` (last 12 months from levy sync) | `{ month, amount }` series |
| `fundingSummary` | `das_funding_payments` | `totalReceived`, `lastPaymentDate`, `pendingClawbackCount` — see [das-funding-sync.md](./das-funding-sync.md) |

### OTJ in breakdown

Breakdown rows include `averageOtjPercent` using approved OTJ log minutes vs expected minutes:

```
expectedMinutes = plannedDurationMonths × 20 hours/month × 60
averageOtjPercent = min(100, approvedMinutes / expectedMinutes × 100)
```

The `20` hours/month constant aligns with the OTJ 20% rule baseline documented in OTJ PRD.

### Known stubs

- EPA pass rate
- Scheduled email delivery and year-on-year history (out of scope)

## RPT-004 — Levy utilisation (PRD-012 / F1.1.3)

`GET /api/v1/reporting/levy-utilisation` — employer portal only.

**Response `data`:**

| Field | Source |
|---|---|
| `segments` | `das_levy_balances.utilisationSegments` (used / expiring within 90d / available) |
| `monthlySeries` | Last 12 months from `das_levy_monthly_entries` (`contributions` + `spend` per month) |
| `forecast` | `DasLevyForecastService` |
| `costPerApprentice` | Breakdown rows from levy ROI service (by standard + provider) |

Monthly entries and segments are populated on each successful `DasLevySyncService.syncOrganisation` from tolerant keys in the DAS balance `raw` payload (`monthlyContributions`, `transactions`, `tranches`, etc.).

Levy ROI PDF export includes monthly contributions and utilisation segment breakdown when data is present.

## RPT-002 — Employer directory

PRD: F2.4.1

### Endpoint

`GET /api/v1/reporting/employer-directory`

Paginated list of employers linked on provider-owned enrolments (`employerOrganisationId IS NOT NULL`).

### Row fields

- Organisation name, contact (owner membership name + email, else `orgEmail`)
- `activeLearnerCount`
- `averageOtjPercent` (OTJ helper above, active learners only)
- `commitmentPipelineStatus` — **most advanced** pipeline among active enrolments (`signed` > `awaiting_signatures` > `draft` > `none`)
- `lastVisitDate` — always `null` (reserved for F2.4.2 visit log)
- `region` — employer org `city`

### Filters

| Query param | Effect |
|---|---|
| `region` | Case-insensitive substring match on employer city |
| `minActiveLearners` | Minimum active learners per row |
| `minAverageOtjPercent` | Minimum average OTJ % |
| `page`, `perPage` | Standard pagination |

Cross-org employer reads use the RLS bootstrap pattern (`app.rls_bootstrap=1`) for referenced organisation IDs only.

## RPT-003 — SME overview (Flow portal)

PRD: F4.3.1

`GET /api/v1/reporting/sme-overview` — requires active `flow` portal organisation.

**Response `data`:**

| Section | Contents |
|---------|----------|
| `summary.activeApprenticeCount` | Active enrolments for the org |
| `summary.pendingOtjApprovalCount` | OTJ log entries in `submitted` status |
| `summary.reviewsDueThisMonthCount` | Scheduled reviews in current UTC month |
| `summary.commitmentPipeline` | Counts by pipeline status (`none`, `draft`, `awaitingSignatures`, `signed`, `cancelled`) |
| `summary.fundingClaimStatus` | `synced` / `no_payments` / `clawback_pending` from latest DAS funding payments |
| `pendingOtjApprovals` | Up to 20 rows: apprentice name, logged date, minutes, enrolment id |
| `apprentices` | Learner name, programme title, OTJ %, next review date, status badge |

## Tests

```bash
yarn test reporting
yarn test das-levy-history das-funding-sync levy-utilisation
yarn test:e2e test/reporting/
yarn test:e2e test/das-funding-sync.e2e-spec.ts
```
