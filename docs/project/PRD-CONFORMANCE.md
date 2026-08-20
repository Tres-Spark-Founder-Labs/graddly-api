# PRD conformance — all four portal apps

Every route in `apps/employer`, `apps/provider`, `apps/apprentice` and `apps/flow`,
checked against the PRD feature it claims to serve.

**Investigation only. Nothing in this report has been implemented or deleted.**

---

## How each verdict was reached

Feature IDs in this report are **not** taken from feature-ID comments in the code.
That was the one source ruled out at the start, and the reason is now demonstrated
rather than assumed: `F1.2.4` is annotated across **22 files** in the frontend, and
the feature it labels calls five endpoints that do not exist.

Each route was instead classified from what it *does*:

1. Every route was walked into its component tree (depth 5) and every API path
   string collected from the path-definition layer — `features/*/services/`,
   `features/*/constants/` and `lib/api/`.
2. Those paths were matched against the API's **272 real endpoints**, extracted by
   parsing every `@Controller` and its method decorators in `graddly-api/src`.
3. The resulting endpoint set was read against the feature's **Description and
   Acceptance criteria** text in `graddly-api/docs/prd/*.md`.

A route that calls `/reporting/levy-utilisation` serves F1.1.3 whatever any comment
says, and a route that calls an endpoint nobody built serves nothing at all.

### Two false leads, recorded so they are not re-investigated

- **`provider/das-health`** first appeared to call three missing endpoints
  (`/enrolment-pushes`, `/completion-pushes`, `/withdrawal-pushes`). Those strings are
  `base` constants composed at call time into `${base}/failed` and `${base}/${id}/retry`,
  which all exist. The route conforms.
- **`/api/proxy`** looked like a missing endpoint in 16 routes. It is the Next.js BFF
  route handler, present in all four apps at `app/api/proxy/[...path]/route.js`.

---

## Correction — four of seven Must Have "gaps" were wrong

The first version of this report named seven Must Have features with no route.
Per-criterion verification reduced that to **four**. The headline finding, F1.1.1, was
the most wrong of them, and it was wrong in the way this report warns against: I
concluded a feature was absent because *one particular endpoint* was not called.

| Feature | What I claimed | What is true |
| --- | --- | --- |
| **F1.1.1** | No employer route serves it; the dashboard shows levy-exchange surplus instead. | Wrong on the substance, and it was the headline finding. The employer dashboard resolves its balance through `useDasSync` (`components/dashboard/levy/useDasSync.js:40-47`), which sums `lastBalance` across linked DAS accounts from `/levy-exchange/donor-links` — **not** `availableSurplus`. `das-donor-link.service.ts:161-165` sets that field from `dasHttpClient.fetchLevyBalance(ukprn, accessToken)`, a live OAuth call to the DAS API. All five acceptance criteria are met — see the per-criterion table. It was true but irrelevant that no employer route calls `GET /das/levy-balance`: that endpoint returns the *persisted* balance for the active organisation and is one of two DAS-sourced paths, not the only one. |
| **F3.1.4** | No API and no route. | Wrong. `graddly-api/src/otj/otj-pace.service.ts` and `otj-pace-calculator.ts` compute pace with thresholds `OTJ_AT_RISK_THRESHOLD_PERCENT = 15` and `OTJ_OVERDUE_THRESHOLD_PERCENT = 30` — exactly the AC1/AC2 boundaries, strictly-greater as the AC words it. The apprentice renders `summary.otjPace.alertLevel` at `DashboardHome.jsx:778` and `AnalyticsStats.jsx:61`, reached via `/learners/me/summary`. AC3 (push notification after 7 days without a log) is the only part not confirmed. |
| **F3.3.1** | Served only by a fabricated route. | Wrong as stated. A real, API-backed evidence library exists at `apprentice/curriculum` — `PortfolioView.jsx` uses `useEvidenceItems` and `useKsbHeatmap` with no hardcoded data. The finding is therefore that `/portfolio` is a **fabricated duplicate of a working feature**, not that the feature is missing. The fabrication is real and still worth fixing; the absence was not. |

The endpoint-existence test is good at finding fabrication — it caught F1.2.4, which
turned out to be worse than it looked — but it cannot establish absence. A feature
served through a different endpoint than the expected one reads identically to a
feature that was never built.

### F1.1.1 Real-Time Levy Balance Display — per acceptance criterion

| # | Acceptance criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| AC1 | Balance displayed in GBP to two decimal places on load | **MET** | `OverviewPanel.jsx:127` renders `fmtGBP(das.balance)`; `helpers.js:15-26` sets `style: "currency", currency: "GBP", min/maxFractionDigits: 2`. Renders an em dash rather than £0.00 when no account is linked. |
| AC2 | Sourced directly from ESFA DAS API, no manual entry | **MET** | `useDasSync.js:40-47` sums `lastBalance` across linked accounts. `das-donor-link.service.ts:161-165` sets it from `dasHttpClient.fetchLevyBalance(ukprn, accessToken)` after an OAuth refresh. No write path accepts a manual balance. |
| AC3 | Last-synced timestamp displayed alongside the balance | **MET** | `OverviewPanel.jsx:129-135` renders `` `DAS · synced ${das.fmtSyncedAt()}` `` as the sub-label of the balance tile itself. |
| AC4 | Degraded-mode banner with last known balance and sync time | **MET** | `DasSyncBanner.jsx:23-29` — "DAS API unavailable — displaying last known data", then "Last known balance {fmtGBP(balance)}, accurate as of {fmtSyncedAt()}". Triggered by `isDegraded` in `useDasSync.js:30-33`. |
| AC5 | Updates automatically without page reload every 15 minutes | **MET** | `levy.query.js:102` `DAS_BALANCE_POLL_MS = 15 * 60 * 1000`, applied as `refetchInterval` on `useDonorLinks` at line 112. |

**Does any employer screen call `GET /das/levy-balance`? No — none does.** That is the
one part of the original finding that stands, and it is not a defect. There are two
DAS-sourced paths: `/das/levy-balance` returns the *persisted* balance for the active
organisation (used by `provider/das-health` and `provider/funding`), while the employer
reads per-account `lastBalance` through `/levy-exchange/donor-links`, which supports the
multi-account summing the employer dashboard needs and that a single-value endpoint
does not. The provider and flow display components are therefore **not** needed here —
the employer already has a more capable implementation.

**F1.1.2 and F1.1.3 are not reading a wrong source either.** F1.1.2's expiry data comes
from `das_levy_tranches`, parsed from the DAS raw payload by
`das-donor-sync.service.ts:43-67` (`replaceTranches(donorLinkId, organisationId, rawPayload)`)
during the same sync that sets the balance. F1.1.3 reads `/reporting/levy-utilisation`,
an aggregate appropriate to a utilisation chart.

---

## Summary

| Verdict | Routes |
| --- | ---: |
| CONFORMS | 80 |
| MISLABELLED | 10 |
| FABRICATED | 3 |
| STUB | 14 |
| OUT OF SCOPE | 7 |
| **Total** | **114** |

| Portal | Routes | Conforms | Mislabelled | Fabricated | Stub | Out of scope |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Portal 1 — Employer | 32 | 20 | 1 | 2 | 8 | 1 |
| Portal 3 — Apprentice | 25 | 11 | 9 | 1 | 3 | 1 |
| Portal 2 — Provider | 31 | 29 | 0 | 0 | 0 | 2 |
| Portal 4 — Flow | 26 | 20 | 0 | 0 | 3 | 3 |

---

## Portal 1 — Employer  (`apps/employer`)

| Route | Renders | Feature | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| `/at-risk` | `AtRiskDashboard` | F1.2.4 At-Risk Automated Flagging | **FABRICATED** | Calls /apprentices/at-risk, /apprentices/:id/interventions, /messages, /reviewed, /reviews — none exist in the API. Only the badge count (/learners/intervention-queue) is real. |
| `/at-risk/[id]` | `AtRiskDetail` | F1.2.4 At-Risk Automated Flagging | **FABRICATED** | Same five non-existent endpoints as /at-risk. |
| `/onboarding` | `OtjApprovalsTable` | F1.2.3 OTJ Log Approval Workflow | **MISLABELLED** | Titled "Onboarding — New apprentice checklists" but renders OtjApprovalsTable, the same component as /otj-approvals. Serves F1.2.3 under a non-PRD name; the PRD has no "Onboarding" feature. |
| `/profile` | `ProfileForm` | — | **OUT OF SCOPE** | Account profile form. No PRD feature defines it; it is ordinary account management that every portal needs. |
| `/analytics/hiring` | `EmptyPage` | — | **STUB** | EmptyPage. "Hiring" is an ATS concept, not a PRD feature. |
| `/analytics/performance` | `EmptyPage` | — | **STUB** | EmptyPage. Closest PRD feature is F1.4.2 Provider Performance Comparison (Should Have), which is unbuilt — see gap table. |
| `/applications` | `EmptyPage` | — | **STUB** | EmptyPage. ATS leftover — the PRD has no job-application concept. |
| `/applications/rejected` | `EmptyPage` | — | **STUB** | EmptyPage. ATS leftover. |
| `/applications/review` | `EmptyPage` | — | **STUB** | EmptyPage. ATS leftover. |
| `/applications/shortlisted` | `EmptyPage` | — | **STUB** | EmptyPage. ATS leftover. |
| `/billing` | `EmptyPage` | — | **STUB** | EmptyPage. No PRD feature; levy funding is not subscription billing. Safe to delete. |
| `/jobs` | `EmptyPage` | — | **STUB** | EmptyPage. Recruitment/ATS concept — no PRD feature. Safe to delete. |
| `/` | `Dashboard` | F1.1.1 Real-Time Levy Balance Display | **CONFORMS** | Balance comes from useDasSync (useDasSync.js:40-47), summing lastBalance across /levy-exchange/donor-links — set from dasHttpClient.fetchLevyBalance(), a live DAS OAuth call. All five F1.1.1 ACs verified. Also serves F1.1.2 via /surplus/expiry-calendar, whose tranches are parsed from the DAS raw payload. |
| `/accept-invitation` | `AcceptInviteView` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/analytics` | `LevyUtilisationView` | F1.1.3 Levy Utilisation Chart & Forecast | **CONFORMS** | Calls /reporting/levy-utilisation — F1.1.3 Levy Utilisation Chart & Forecast. |
| `/analytics/cost` | `LevyRoiView` | F1.4.1 Levy ROI Report | **CONFORMS** | Calls /reporting/levy-roi and /reporting/levy-roi/breakdown — F1.4.1 Levy ROI Report. |
| `/apprentices` | `ApprenticesDashboard` | F1.2.1 All-Apprentice Overview Dashboard | **CONFORMS** | Calls /apprentices and /enrolments — F1.2.1 All-Apprentice Overview. EnrolDrawer covers F1.2.5 AC1. |
| `/commitments` | `CommitmentsDashboard` | F1.3.1 Commitment Statement Status Board | **CONFORMS** | Calls /commitment-statements plus /versions (F1.3.3 audit trail) and /esignature/records/:id/sign (F1.3.2). |
| `/donor-analytics` | `DonorAnalyticsDashboard` | F4.1.4 Donor Analytics Portal | **CONFORMS** | Calls /levy-exchange/surplus and /donor-links. F4.1.4 lives in the employer portal by architectural decision — the donor IS the levy-paying employer. |
| `/forgot-password` | `ForgotPasswordView` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/levy-dashboard` | `Dashboard` | F1.1.1 Real-Time Levy Balance Display | **CONFORMS** | Identical LevyDashboard component to /. Duplicate entry point for F1.1.1 and F1.1.2. |
| `/levy-transfer` | `LevyTransferDashboard` | F1.1.4 Levy Transfer Hub | **CONFORMS** | Calls /levy-exchange/donor-links and transfer endpoints — F1.1.4 Levy Transfer Hub (Should Have). Also serves F4.2.3 Donor-SME Matching. |
| `/login` | `LoginForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/messages` | `MessagesView` | F3.4.2 Direct Messaging | **CONFORMS** | Calls /messaging/threads — the employer counterpart of F3.4.2 Direct Messaging. |
| `/otj-approvals` | `OTJApprovalsDashboard` | F1.2.3 OTJ Log Approval Workflow | **CONFORMS** | Calls /otj-log-entries/bulk-approve and /bulk-reject — F1.2.3 OTJ Log Approval Workflow. |
| `/reports` | `ReportsDashboard` | F1.1.5 Levy Report Export | **CONFORMS** | Calls /reporting/levy-roi/export — F1.1.5 Levy Report Export. |
| `/reset-password` | `ResetPasswordForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/reviews` | `EmployerReviewsTable` | F2.2.3 12-Weekly Review Scheduler | **CONFORMS** | Calls /reviews/:id/record — the employer view of the 12-weekly review (F2.2.3 AC: tripartite, employer participates). |
| `/reviews/[id]` | `EmployerReviewDetail` | F2.2.3 12-Weekly Review Scheduler | **CONFORMS** | Review detail and record capture. |
| `/settings/[[...slug]]` | `SettingsView` | F3.4.3 Notification Centre | **CONFORMS** | Calls /notifications, /notifications/read-all — F3.4.3 Notification Centre, reached through Settings rather than its own route. |
| `/signup` | `SignupForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/verify-email` | `VerifyEmailForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |

## Portal 3 — Apprentice  (`apps/apprentice`)

| Route | Renders | Feature | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| `/portfolio` | `Portfolio` | F3.3.1 Evidence Library | **FABRICATED** | PortfolioEvidenceList.jsx:136 does `const all = [...fresh, ...EVIDENCE]` — a hardcoded array of invented evidence items concatenated with real data, and line 138 `const total = 31 + newEvidence.length` hardcodes a baseline count of 31. The KSB grid and gateway panel around it are real. Note this duplicates /curriculum, which renders the SAME feature correctly from the API — so this is a fabricated second view of a working feature, not the only implementation. |
| `/analytics` | `AnalyticsStats` | F3.1.2 OTJ Progress Visualisation | **MISLABELLED** | Renders AnalyticsStats over the same OTJ endpoints. Duplicate of /progress under a second non-PRD name; the PRD gives the apprentice no "Analytics" feature. |
| `/assessments` | `ReviewsTable` | F3.2.4 Review History | **MISLABELLED** | Renders ReviewsTable over /reviews. This is F3.2.4 Review History; "Assessments" is not a PRD name and misleadingly suggests EPA assessment. |
| `/courses` | `EnrolmentsTable` | F3.2.1 Programme Timeline | **MISLABELLED** | Renders EnrolmentsTable over /enrolments. The PRD calls this the programme/enrolment, never a "course". |
| `/courses/live` | `EnrolmentsTable` | F3.2.1 Programme Timeline | **MISLABELLED** | Identical component and endpoints to /courses. Duplicate under an invented status split. |
| `/curriculum` | `PortfolioView` | F3.3.1 Evidence Library | **MISLABELLED** | Renders PortfolioView using useEvidenceItems and useKsbHeatmap — the real, API-backed F3.3.1 Evidence Library and F3.3.2 KSB Heatmap, with no hardcoded data. This is where the working evidence library lives; "Curriculum" is not a PRD name. |
| `/progress` | `OtjLogTable` | F3.1.2 OTJ Progress Visualisation | **MISLABELLED** | Renders OtjLogTable over /otj-log-entries and /learners/me/summary. This is F3.1.2 OTJ Progress Visualisation and F3.1.3 Session History; "Progress" is not a PRD feature name. |
| `/reports` | `DocumentsList` | F3.3.4 EPA Evidence Pack Export | **MISLABELLED** | Renders DocumentsList over /learners/me/documents. Closest PRD feature is F3.3.4 EPA Evidence Pack Export, but it lists documents rather than compiling the pack — see gap table. |
| `/reports/completion` | `DocumentsList` | F3.3.4 EPA Evidence Pack Export | **MISLABELLED** | Same component and endpoint as /reports. |
| `/reports/engagement` | `DocumentsList` | F3.3.4 EPA Evidence Pack Export | **MISLABELLED** | Same component and endpoint as /reports. |
| `/profile` | `ProfileForm` | — | **OUT OF SCOPE** | Account profile form. No PRD feature. |
| `/courses/archived` | `EmptyPage` | — | **STUB** | EmptyPage. No PRD concept of an archived course. |
| `/courses/drafts` | `EmptyPage` | — | **STUB** | EmptyPage. An apprentice cannot draft a course; this is authoring-tool language. |
| `/learners` | `EmptyPage` | — | **STUB** | EmptyPage. An apprentice has no learners. LMS-instructor leftover. |
| `/` | `DashboardHome` | F3.2.3 EPA Countdown | **CONFORMS** | Calls /learners/me/summary; renders HomeEpaCountdown — F3.2.3 EPA Countdown. |
| `/accept-invitation` | `AcceptInviteView` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/forgot-password` | `ForgotPasswordView` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/journey` | `JourneyView` | F3.2.1 Programme Timeline | **CONFORMS** | Calls /learners/me/summary — F3.2.1 Programme Timeline and F3.2.3 EPA Countdown. |
| `/login` | `LoginForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/messages` | `MessagesView` | F3.4.2 Direct Messaging | **CONFORMS** | Calls /messaging/threads and /messages — F3.4.2 Direct Messaging. |
| `/otj-logs` | `OTJLogs` | F3.1.1 Quick OTJ Log Entry | **CONFORMS** | Calls /otj-log-entries and /categories — F3.1.1 Quick OTJ Log Entry and F3.1.3 OTJ Session History. |
| `/reset-password` | `ResetPasswordForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/settings/[[...slug]]` | `SettingsView` | F3.4.3 Notification Centre | **CONFORMS** | Calls /notifications, /read-all, /:id/read — F3.4.3 Notification Centre. |
| `/signup` | `SignupForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/verify-email` | `VerifyEmailForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |

## Portal 2 — Provider  (`apps/provider`)

| Route | Renders | Feature | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| `/profile` | `ProfileForm` | — | **OUT OF SCOPE** | Account profile form. No PRD feature. |
| `/programmes` | `ProgrammesTable` | — | **OUT OF SCOPE** | Calls /programmes. Programme/standard administration is reference-data management; no PRD feature defines a provider programmes screen. Supports F3.2.1 indirectly by maintaining the data it renders — see GATE note. |
| `/` | `DashboardHome` | F2.2.1 Full Cohort Dashboard | **CONFORMS** | Calls /reporting/provider-dashboard and /learners/cohort — F2.2.1 Full Cohort Dashboard. |
| `/accept-invitation` | `AcceptInviteView` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/apprentices` | `ApprenticesTable` | F2.2.4 Individual Learner Profile | **CONFORMS** | Calls /apprentices/:id. Overlaps /learners; both serve the cohort/profile pair. |
| `/commitment-statements` | `CommitmentStatementsTable` | F1.3.1 Commitment Statement Status Board | **CONFORMS** | Calls /commitment-statements/:id/versions, /publish, /cancel — F1.3.1 status board and F1.3.3 audit trail. |
| `/das-health` | `DasSyncStatusCard` | F2.3.1 Two-Way DAS Sync | **CONFORMS** | Calls /das/sync, /das/levy-balance and the three push pipelines — F2.3.1 Two-Way DAS Sync. |
| `/employers` | `EmployerDirectory` | F2.4.1 Employer Directory | **CONFORMS** | Employer directory plus visit log — F2.4.1 and F2.4.2. |
| `/enrolments` | `EnrolmentsTable` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Calls /enrolments/counterpart-organisations/lookup and /participant-options — the provider half of F1.2.5 AC4 (provider accepts). |
| `/enrolments/[id]` | `EnrolmentDetailView` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Enrolment detail, commitment statement and EPA pack job triggers. |
| `/esignature` | `EsignatureTool` | F1.3.2 Commitment Statement E-Signature | **CONFORMS** | Calls /esignature/records/:id/sign — F1.3.2 Commitment Statement E-Signature. |
| `/forgot-password` | `ForgotPasswordView` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/funding` | `LevyBalanceCard` | F2.3.1 Two-Way DAS Sync | **CONFORMS** | Calls /das/levy-balance, /levy-forecast, /funding-payments. Also serves F4.3.3 ESFA Funding Claim Tracker via /ilr/funding-claims. |
| `/ilr` | `IlrView` | F2.3.2 ILR Build and Submission | **CONFORMS** | Calls /ilr/learner-records/build and /validate — F2.3.2 ILR Build and Submission. |
| `/ilr/[recordId]` | `IlrRecordDetailView` | F2.3.2 ILR Build and Submission | **CONFORMS** | ILR record detail and validation errors. |
| `/learners` | `LearnersView` | F2.2.1 Full Cohort Dashboard | **CONFORMS** | Calls /learners/cohort, /filter-options, /export and /learners/intervention-queue — F2.2.1 plus F2.2.2 At-Risk Intervention Queue. |
| `/learners/[enrolmentId]` | `LearnerProfileView` | F2.2.4 Individual Learner Profile | **CONFORMS** | Calls /enrolments/:id/participants and /organisation-links — F2.2.4 Individual Learner Profile. |
| `/login` | `LoginForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/ofsted-hub` | `OfstedHub` | F2.1.1 Live EIF Readiness Score | **CONFORMS** | Calls /ofsted/eif-criteria, /eif-scores, /eif-scores/trend, /qip-actions, /sar-reports, /ofsted/evidence-packs — F2.1.1, F2.1.2, F2.1.3 and F2.1.4 all in one screen. |
| `/otj-log-entries` | `OtjReviewQueue` | F1.2.3 OTJ Log Approval Workflow | **CONFORMS** | Calls /otj-log-entries/bulk-approve, /bulk-reject, /:id/flag — provider side of the OTJ approval workflow. |
| `/otj-log-entries/[id]` | `OtjEntryDetailView` | F1.2.3 OTJ Log Approval Workflow | **CONFORMS** | Single OTJ entry review. |
| `/portfolio/evidence` | `EvidenceQueue` | F3.3.2 KSB Coverage Heatmap | **CONFORMS** | Calls /portfolio/ksb-heatmap and /ksb-coverage — provider view of F3.3.2 KSB Coverage Heatmap. |
| `/portfolio/evidence/[id]` | `EvidenceDetailView` | F3.3.1 Evidence Library | **CONFORMS** | Evidence item detail — provider assessment of F3.3.1 Evidence Library items. |
| `/reset-password` | `ResetPasswordForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/reviews` | `ReviewsTable` | F2.2.3 12-Weekly Review Scheduler | **CONFORMS** | Calls /learners/cohort and review endpoints — F2.2.3 12-Weekly Review Scheduler. |
| `/reviews/[id]` | `ReviewDetailView` | F2.2.3 12-Weekly Review Scheduler | **CONFORMS** | Calls /reviews/:id/record and /previous-goals — F2.2.3 AC (previous goals carried forward). |
| `/reviews/calendar` | `ReviewCalendar` | F2.2.3 12-Weekly Review Scheduler | **CONFORMS** | Calls /reviews/bulk-schedule and /from-enrolments — F2.2.3 AC (bulk schedule at 12-week intervals). |
| `/settings/[[...slug]]` | `SettingsView` | F3.4.3 Notification Centre | **CONFORMS** | Notification centre and invitations. |
| `/signup` | `SignupForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/standards` | `StandardsTable` | F3.3.2 KSB Coverage Heatmap | **CONFORMS** | Calls /standards/:id/ksb-definitions — the KSB reference data F3.3.2 is built on. |
| `/verify-email` | `VerifyEmailForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |

## Portal 4 — Flow  (`apps/flow`)

| Route | Renders | Feature | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| `/courses` | `AiProgrammeCatalogue` | F4.3.4 SME Onboarding Concierge | **OUT OF SCOPE** | Calls /ai-programmes/catalogue. An AI programme catalogue appears in no PRD feature. Closest is F4.3.4 SME Onboarding Concierge, whose ACs describe a Success Manager and checklist, not a course catalogue — see GATE note. |
| `/courses/[id]` | `AiProgrammeDetail` | — | **OUT OF SCOPE** | AI programme detail and enrolment. Same as /courses. |
| `/profile` | `ProfileForm` | — | **OUT OF SCOPE** | Account profile form. No PRD feature. |
| `/learners` | `EmptyPage` | — | **STUB** | EmptyPage. F4.3.1 is served by / and /analytics; this is an unfinished third entry point. |
| `/reports/completion` | `EmptyPage` | — | **STUB** | EmptyPage. |
| `/reports/engagement` | `EmptyPage` | — | **STUB** | EmptyPage. |
| `/` | `DashboardHome` | F4.3.1 SME Apprentice Overview | **CONFORMS** | Calls /reporting/sme-overview — F4.3.1 SME Apprentice Overview. |
| `/accept-invitation` | `AcceptInviteView` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/analytics` | `SmeOverviewPanel` | F4.3.1 SME Apprentice Overview | **CONFORMS** | Same SmeOverviewPanel and endpoint as /. Duplicate entry point. |
| `/approvals` | `OtjReviewQueue` | F1.2.3 OTJ Log Approval Workflow | **CONFORMS** | Calls /otj-log-entries/bulk-approve and /bulk-reject — the SME employer half of F1.2.3. |
| `/commitment-statements` | `CommitmentStatementsTable` | F4.3.2 Commitment Statement Management | **CONFORMS** | Calls /commitment-statements/:id/sign, /publish, /versions — F4.3.2 Commitment Statement Management. |
| `/eligibility` | `EligibilityChecker` | F4.2.1 Levy Eligibility Checker | **CONFORMS** | Calls /levy-exchange/eligibility/check — F4.2.1 Levy Eligibility Checker. |
| `/forgot-password` | `ForgotPasswordView` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/funding` | `LevyBalanceCard` | F2.3.1 Two-Way DAS Sync | **CONFORMS** | Calls /das/levy-balance, /levy-forecast, /funding-payments. |
| `/learners/[enrolmentId]` | `LearnerProgressView` | F4.3.1 SME Apprentice Overview | **CONFORMS** | Learner progress for the SME employer. |
| `/login` | `LoginForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/messages` | `MessagesView` | F3.4.2 Direct Messaging | **CONFORMS** | Calls /messaging/threads — F3.4.2 Direct Messaging. |
| `/register` | `RegistrationWizard` | F4.2.2 ESFA Registration Wizard | **CONFORMS** | Calls /flowportal-registration/sessions and /steps/:step — F4.2.2 ESFA Registration Wizard. |
| `/reports` | `SmeOverviewPanel` | F4.3.1 SME Apprentice Overview | **CONFORMS** | Same SmeOverviewPanel and endpoint again. Third entry point for one feature. |
| `/reset-password` | `ResetPasswordForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/reviews` | `ReviewsTable` | F2.2.3 12-Weekly Review Scheduler | **CONFORMS** | Calls /reviews/bulk-schedule and /:id/record. |
| `/reviews/[id]` | `ReviewDetailView` | F2.2.3 12-Weekly Review Scheduler | **CONFORMS** | Calls /reviews/:id/sign and /snapshot-pdf. |
| `/reviews/calendar` | `ReviewCalendar` | F2.2.3 12-Weekly Review Scheduler | **CONFORMS** | Review scheduling calendar. |
| `/settings/[[...slug]]` | `SettingsView` | F3.4.3 Notification Centre | **CONFORMS** | Notification centre and invitations. |
| `/signup` | `SignupForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |
| `/verify-email` | `VerifyEmailForm` | F1.2.5 New Apprentice Enrolment | **CONFORMS** | Platform authentication. Serves F1.2.5 AC3 (magic-link invitation to create the Portal 3 account) and the equivalent invitation step in every portal. Not a portal feature in its own right. |

---

## PRD features with no route serving them

A missing feature matters more than a spare route, so this is the half of the report
worth acting on first.

| Feature | Priority | Portal | API exists? | What is missing |
| --- | --- | --- | --- | --- |
| **F1.2.4** At-Risk Automated Flagging | Must Have | Employer | Partial — only `GET /learners/intervention-queue` | Confirmed and worse than first reported. `at-risk.service.js` contains **8 `// MOCK:` markers**; every real call is commented out, including `getAtRiskList` (line 38-50), which does `await delay(450)` and returns the `AT_RISK_SUMMARY` and `AT_RISK_APPRENTICES` constants. The endpoints are not merely missing from the API — the frontend never calls them. Only the sidebar badge count is real. |
| **F3.3.4** EPA Evidence Pack Export | Must Have | Apprentice | Yes — `POST /portfolio/epa-pack-jobs`, `GET /portfolio/epa-pack-jobs/:id` | Confirmed. `epa-pack` appears nowhere in `apps/apprentice`; the only callers are `provider/features/portfolio/constants` and its query keys. AC puts the export in the apprentice's hands ("a single tap, ready for submission to their EPAO"). **Missing: route + component + query/service.** The provider constants and query layer are reusable; the one-tap apprentice UX exists nowhere. |
| **F3.4.1** Commitment Statement Signing | Must Have | Apprentice | Yes — `POST /esignature/records/:id/sign` | Confirmed. `apps/apprentice/features/esignature/` contains exactly one file — `SignaturePad.jsx` — and it is **imported nowhere**: a component built for this feature and never wired. **Missing: route + query + service + the plain-English summary view.** The provider slice is complete (EsignatureTool, SignaturePad, SignatureStatusBadge, constants, queries, schemas, services) and its query/service layer is directly reusable. The AC-specific UI — plain-English summary, "View full statement" toggle, confirmation checkbox — exists in no portal. |
| **F4.3.4** SME Onboarding Concierge | Must Have | Flow | No | Confirmed. `successManager`, `concierge` and `onboarding checklist` return zero matches in both `graddly-api/src` and `apps/flow`. **Missing: everything.** `flow/courses` (the AI programme catalogue) is the nearest existing screen and satisfies no criterion. Depends on client decision 20 (Gradlly staff model). |
| **F1.4.2** Provider Performance Comparison | Should Have | Employer | Yes — `/reporting/levy-roi/provider-comparison.csv`, `/provider-comparison/export` | Backend built and reachable; `employer/analytics/performance` is an EmptyPage. **Missing: component + wiring only.** The cheapest item on this list. |
| **F3.3.3** Reflective Statement Tool | Should Have | Apprentice | No | No `reflective`/`reflection` handling in the API at all. In the apprentice app the only matches are a `RatingsReflection` component holding free-text in local state, and the string "Reflection" inside the fabricated EVIDENCE array. AC requires a STAR-framework editor with 30-second auto-save and a word-count indicator — none of which exists. |
| **F2.4.3** Employer Satisfaction Survey | Could Have | Provider | Yes — `POST /surveys/templates`, `GET /public/surveys/:token`, `POST /:token/responses` | Full survey API including a public token-based response endpoint. The string `survey` appears in no frontend app at all. **Missing: route + component + wiring.** |

**4 of the 45 Must Have features have no route that serves them**, 
plus 3 Should Have / Could Have.

---

## GATE — routes marked OUT OF SCOPE that still earn their place

The instruction was to say so where an out-of-scope route serves a PRD criterion
indirectly, because deleting a working feature is worse than keeping a spare route.
Four cases qualify. **None of these should be deleted on the strength of this report.**

| Route | Why it is out of scope | Why it should stay anyway |
| --- | --- | --- |
| `provider/programmes` | No PRD feature defines a provider programmes screen. | It maintains the programme and standard reference data that F3.2.1 Programme Timeline, F2.3.2 ILR Build and F3.3.2 KSB Heatmap all render. Removing the only maintenance UI for data three Must Haves depend on would be a net loss. |
| `flow/courses`, `flow/courses/[id]` | An AI programme catalogue appears in no PRD feature. F4.3.4, the nearest, describes a Success Manager and onboarding checklist — not a catalogue. | It is a complete working feature with a real API surface (`/ai-programmes/catalogue`, `/enrolments`, `/progress`, `/complete`) and a seeded catalogue. It is scope the PRD does not cover, not scope the PRD excludes. Escalate to the client before touching it. |
| `/profile` × 4 portals | No PRD feature defines a standalone account profile page. | F1.2.2 AC requires personal details be maintained somewhere, and every portal needs account management. Ordinary infrastructure the PRD assumes rather than specifies. |
| Auth routes × 4 portals (24 routes) | No portal feature defines login, signup or password reset. | F1.2.5 AC3 requires a magic-link invitation that creates the Portal 3 account, so the invitation and verification flow is a stated criterion. Classified CONFORMS rather than out of scope for that reason. |

---

## Duplicate routes — one feature, several front doors

Not a verdict category, but it distorts any count of "how much is built". Nine routes
render a feature that another route already renders, with the same component and the
same endpoints.

| Feature | Routes serving it | Note |
| --- | --- | --- |
| F1.1.2 Levy Expiry Alert | `employer/` · `employer/levy-dashboard` | Identical `Dashboard` component. |
| F1.2.3 OTJ Approval | `employer/otj-approvals` · `employer/onboarding` | `/onboarding` is titled "New apprentice checklists" and renders `OtjApprovalsTable`. |
| F3.1.2 OTJ Progress | `apprentice/progress` · `apprentice/analytics` | Both over the same OTJ endpoints, both under non-PRD names. |
| F3.2.1 Programme Timeline | `apprentice/courses` · `apprentice/courses/live` | Identical `EnrolmentsTable`; the live/archived/drafts split is invented. |
| F3.3.4 (nearest) Documents | `apprentice/reports` · `/reports/completion` · `/reports/engagement` | Three routes, one `DocumentsList`, one endpoint. |
| F4.3.1 SME Overview | `flow/` · `flow/analytics` · `flow/reports` | Three routes, one `SmeOverviewPanel`, one endpoint. |

---

## Method notes and limits

- Endpoint detection reads string literals from the path-definition layer. A path
  assembled from fragments at call time would be missed. One such case was found and
  handled by hand (`das-pushes` `base` constants); others may exist.
- `apps/main` (the marketing site) is out of scope for this report, which covers the
  four portal apps named in the request.
- Verdicts are per route. Several routes serve more than one feature — `provider/ofsted-hub`
  alone covers F2.1.1 through F2.1.4 — and the table names the primary one, with the
  others in the evidence column.
- "CONFORMS" means the route serves the feature and its endpoints exist. It is not a
  statement that every acceptance criterion is met; that needs per-AC testing, which
  this report does not attempt.

