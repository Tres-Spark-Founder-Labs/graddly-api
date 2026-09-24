# Deviations from the PRD

Places where the build knowingly does something the PRD does not specify,
recorded so that the PRD's vocabulary is not widened silently. Each one needs
the client's confirmation; until it is given, the PRD text stands and the
deviation is the build's proposal.

| ID   | Feature and criterion               | Deviation                                                                                                          | Status                                                        |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| D-01 | F2.2.1 AC3, F1.2.1 AC3              | A grey "Pace unknown" status badge                                                                                 | Awaiting client confirmation                                  |
| D-02 | F4.3.4, F3.3.2 AC2; §10.1           | Four Phase 1 items moved to Phase 2 at the close-out                                                               | Agreed at the Phase 1 close-out, 21 September 2026            |
| D-03 | F2.3.2 AC1, AC2, AC5; §8.2          | The ILR carries a v1 field subset, two validation rules, a stub ESFA client, and a file download for manual upload | Proposed for Phase 2; **client has not confirmed in writing** |
| D-04 | F4.1.1–F4.1.4, incl. F4.1.2 AC3–AC5 | The donor half of the Levy Exchange is in the employer portal, not FlowPortal                                      | Awaiting client confirmation                                  |
| D-05 | F1.1.1 AC2                          | A guarded manual entry path for levy figures, alongside the DAS sync                                               | Accepted by the client                                        |

> **On the numbering.** D-05 is the manual levy entry deviation, not D-01.
> D-01 was written first, for the "Pace unknown" badge, and is already cited
> in commit messages in both repositories (`122b291`, `b930139`) as well as
> here. An identifier already cited is not renumbered for tidiness, so the
> manual entry record took the next free number instead. D-02 and D-04 are as
> briefed.

---

## D-01 — "Pace unknown" status badge

**Criteria.**

- F2.2.1 AC3 (provider cohort): "Status badges: On Track / At Risk / Overdue /
  Break in Learning / Withdrawn / EPA Ready".
- F1.2.1 AC3 (employer roster): "Status badges: On Track (green) / At Risk
  (amber) / Overdue (red) / EPA Ready (blue)".

Neither list has a value for a learner whose off-the-job pace is not known.

**What the build does.** Where the enrolment has no OTJ pace level, the badge
is a grey "Pace unknown" (API label "Pace Unknown";
`LearnerStatusBadge.PACE_UNKNOWN`, value `pace_unknown`, in the provider
cohort; `PACE_STATUS.UNKNOWN` in the employer roster and its PDF). It is not
a flag: it is not counted as at risk, it does not enter the intervention
queue, and it does not raise the at-risk sidebar count.

**Why.** Both screens used to fall through to the green "On Track" when the
level was missing. That is a statement nobody can back: the level is missing
when the enrolment has no planned duration or end date, and on the employer
roster it also went missing whenever the enrolment fell off the first page of
a paginated list — so an at-risk apprentice rendered green. The alternative
the PRD's lists leave is to pick one of their values, and every one of them is
a claim. Grey is the only honest rendering of "not known".

**Precedence.** Known states outrank it. On the provider badge the order is
withdrawn, break in learning, EPA ready, overdue, at risk, on track, and only
then pace unknown; an overdue review is shown as Overdue whatever the pace.

**Where.**

- API: `src/learners/utils/learner-status-badge.util.ts` (provider cohort
  table, filter, CSV and PDF; the FlowPortal SME overview reads the same
  value); `src/apprentices/apprentice-roster.rules.ts` (employer roster PDF).
- Provider portal: `features/learners/constants`, `components/LearnerBadges.jsx`
  (badge and the status filter's "Pace unknown" option).
- Employer portal: `features/apprentices/utils/risk-status.js`,
  `components/apprentices/helpers.js`.

**If the client declines.** The badge can be renamed or restyled without
changing behaviour. Mapping it back to "On Track" would reinstate the defect
this replaced; the PRD question to settle is what the badge should _say_, not
whether a missing pace may be shown as fine.

---

## D-03 — ILR build and submission are partial

**Criteria.**

- F2.3.2 AC1: "ILR data is auto-populated from platform learner records — no
  manual data re-entry".
- F2.3.2 AC2: "Pre-submission validation checks all required ILR fields
  against ESFA validation rules".
- F2.3.2 AC5: "Submission is made directly to ESFA ILR submission API".
- §8.2: "All mandatory ILR fields auto-populated from Gradlly learner records";
  "Full ESFA validation rules applied before submission"; "Direct API
  submission to ESFA ILR Submission API — no manual file upload to ESFA portal
  required".

**What the build does instead.**

- **Fields.** The mapping config carries nine fields, not the full set a
  funding-model-36 apprenticeship learner needs. Two of the nine were wrong
  and are corrected: `LearnAimRef` is `ZPROG001` for the programme aim (it
  held the standard's code), and dates are written `YYYY-MM-DD` (they were
  `YYYYMMDD`). The standard's own `StdCode` is not mapped: it is the LARS
  code, which the platform does not hold. ULN is entered by hand. The full list of what is missing, and what closing each
  gap takes, is in [../ilr-field-gap.md](../ilr-field-gap.md).
- **Validation.** Two config rules (`ILR001` UKPRN present, `ILR002` start
  not after planned end) against ESFA's several hundred. There is no XSD
  check.
- **Submission.** Through a configurable client, `noop` by default. The
  `http` client is a REST stub against a configured endpoint. The team does
  not know of a public ESFA API for ILR submission; providers normally upload
  the file to Submit Learner Data. That is an open question for the client.
- **File route (5.4).** `GET /ilr/learner-records/return-file` offers the
  whole return as one XML file for manual upload. That is the route §8.2 says
  should not be needed. The file says on screen and inside itself that it
  covers the v1 subset, and it is refused rather than cut short when any
  record in the period is unvalidated. Its header `SerialNo` is always `01`,
  where ESFA expects it to increase across resubmissions (recorded with the
  field map, not fixed).

**Why.** Completing the map needs learner data the platform does not collect
(some of it special-category), external reference data (LARS, the EPAO
register), and a mapping format that can express repeated entities. That
work is sized in `ilr-field-gap.md`. Presenting the current output as a
compliant return would be the larger risk: a short or rejected return is a
funding claim.

**What would close it.**

1. The field-gap work: structure, data capture, reference data, derivations,
   and the remaining v1 fix (serial number).
2. ESFA's validation rules and XSD applied before a file is offered or sent.
3. A decided submission route. Either a real ESFA integration, if one exists
   for third parties, or the client accepting file upload to Submit Learner
   Data as the route, which would amend AC5 and §8.2.

**Decision needed.** Whether F2.3.2 ships in Phase 1 with this gap declared, or
moves to Phase 2.

**Acceptance.** Not accepted. The field gap is _proposed_ for Phase 2 and the
client has not confirmed it in writing. Until that confirmation exists this
record is the build's proposal and F2.3.2 remains a Phase 1 Must Have (§10.1)
that the build does not meet — it is not a deferral, and it should not be read
as one in a conformance report.

**Reversed when.** The three items under "What would close it" are delivered,
or the client amends AC5 and §8.2 to accept file upload to Submit Learner Data
as the submission route.

---

## D-02 — Four Phase 1 items moved to Phase 2 at the close-out

**Criteria.**

- §10.1 places F4.3.4 and F3.3.2 in Phase 1 MVP scope: "The MVP must include
  all Must Have requirements across all four portals."
- F4.3.4 (SME Onboarding Concierge), Must Have, Phase 1: "On account creation,
  SME is assigned a named Success Manager (Gradlly staff)"; "Concierge
  dashboard shows: onboarding checklist completion %, upcoming scheduled calls,
  and direct message thread with Success Manager"; "Automated milestone emails
  are sent at: registration, DAS linking, first learner enrolment, first OTJ
  approval, first review"; "Money-back guarantee is documented in the SME
  welcome pack and linked from the dashboard".
- F3.3.2 AC2 (KSB Coverage Heatmap), Must Have, Phase 1: "Cell colour
  indicates coverage strength: green (strong — 3+ accepted evidence items) /
  blue (good — 2 items) / amber (partial — 1 item) / red (weak — drafted only)
  / grey (missing — no evidence)".

**What the build does instead.**

1. **SME onboarding concierge (F4.3.4) — not built.** No Success Manager
   assignment, no concierge dashboard, no milestone email sequence, no linked
   welcome pack. `successManager`, `concierge` and `onboarding checklist`
   return no matches in the API or the flow app. It also depends on a staffing
   model the client has not settled.
2. **KSB heatmap bands (F3.3.2 AC2) — three, not five.**
   `KsbHeatmapStrength` carries `none`, `low` and `adequate`. The specified
   five-band scale, and its dependence on counting accepted evidence items per
   KSB and distinguishing "drafted only" from "none", is not implemented. The
   rest of F3.3.2 is met: the grid, the per-cell evidence list, visibility to
   apprentice and tutor, and the tutor's sufficient / requires-more-evidence
   marking.
3. **Provider and flow portal component tests — not written.** The employer
   and apprentice portals carry component suites; the provider and flow
   portals do not.
4. **Build-time OpenAPI validity check — not wired.** `openapi.json` is
   emitted by `yarn openapi:emit` and is not validated as part of any build or
   CI step, so an invalid document would ship unnoticed.

Items 3 and 4 are worth separating from 1 and 2: **neither is a PRD
criterion.** The non-functional section carries no testing-coverage or
API-document requirement, so they are deferrals against this team's own
engineering standard rather than against the document. They are recorded here
because the close-out treated all four together, and a conformance audit
reading this file should not go looking for criteria they breach.

**What is _not_ deferred, despite appearing on the original close-out list.**

- **Web push.** It was moved and then built anyway. F3.1.4 AC4 ("Push
  notification sent if the apprentice has not logged any OTJ in the last 7
  days") and F3.4.3 AC4 ("Push notification support for native mobile app
  (Phase 2) — web push in MVP") are both met, and web push is therefore not a
  deferral. Any list still carrying it is stale.
- **The audit carve-out.** Reversed on 23 September 2026. The five entities
  that had no trail — `User`, `SafeguardingChecklistItem`, `EpaOutcomeRecord`,
  `BreakInLearning` and `FundingClaimResolution` — are audited, and the
  coverage position is recorded in
  [../project/AUDIT-COVERAGE.md](../project/AUDIT-COVERAGE.md).

**Scope.** Two PRD Must Haves (F4.3.4 in full, F3.3.2 AC2 only) and two
internal engineering standards. No other criterion in §10.1 is affected by
this record.

**Accepted by, and when.** Agreed at the Phase 1 close-out on 21 September 2026. No signatory is recorded: the close-out is not minuted in either
repository — see the note at the foot of this file — so the acceptance has a
date and no name against it. That should be corrected before QA sign-off,
because a deferral of a Must Have with no named accepter is indistinguishable
from a gap nobody noticed.

**Reversed when.** F4.3.4 returns to scope once the client settles the
Success Manager staffing model; F3.3.2 AC2 once evidence counts per KSB drive
a five-band scale; items 3 and 4 whenever the team chooses, since nothing
external depends on them.

---

## D-04 — The donor half of the Levy Exchange is in the employer portal

**Criteria.**

- §6.1 places the Levy Exchange in Portal 4: "Three modules … Module A — Levy
  Exchange marketplace | Module B — SME Employer Dashboard | Module C — AI
  Apprenticeship Programmes", and §6.2.1 titles the features below it
  "Donor-Side Features".
- F4.1.1 (Donor DAS Account Linking), Must Have, Phase 1: "Levy donor
  organisations must be able to link their ESFA Digital Apprenticeship Service
  account to FlowPortal to enable automated transfer processing."
- F4.1.2 (Surplus Levy Calculator & Expiry Alerts), Must Have, Phase 1:
  "Surplus calculator displays: total levy balance, amount already committed
  to own apprenticeships, maximum transferable amount (up to 50% of annual
  contribution), amount already transferred"; AC3 "Automated email alert sent
  when any tranche will expire within 90 days"; AC4 "Second alert sent at 30
  days before expiry"; AC5 "Alert includes a direct CTA to initiate a
  transfer".
- F4.1.3 (Transfer Preference Settings) and F4.1.4 (Donor Analytics Portal),
  both specified under the same FlowPortal module.

**What the build does instead.** All four donor-side features are in the
employer portal: `donor-analytics`, `levy-dashboard`, `levy-data` and
`levy-transfer` are employer routes, and the flow app has no donor linking,
surplus, preferences or analytics screens. The functional criteria are
substantially met — F4.1.2 AC3 to AC5 in particular: both alerts fire at 90
and 30 days and carry a transfer CTA. **What deviates is the portal, not the
behaviour.**

**Why.** A donor DAS link is created in the employer portal, because that is
where an employer already manages its own levy, and one link serves both the
levy dashboard and the exchange. Duplicating the link into FlowPortal would
mean either two links for one DAS account or a cross-portal link whose owner
is ambiguous. The donor is an employer; FlowPortal's stated target users are
"SME owners / managers (5–249 employees), levy donor L&D leads at large
employers, AI apprenticeship learners from SMEs", so the donor appears in both
descriptions and the build resolved that overlap toward the portal the donor
already uses.

**Scope.** One placement decision covering F4.1.1, F4.1.2, F4.1.3 and F4.1.4.
Recorded once rather than four times, because splitting it would imply four
independent choices and invite four independent reversals. The SME side of the
exchange (F4.2.x) is unaffected and remains in FlowPortal.

**Accepted by, and when.** Not accepted. This is the build's proposal and it
has not been put to the client. Until it is, §6.2.1 stands as written and a
conformance audit should read these four features as built in the wrong
portal.

**Reversed when.** The client either confirms the placement — in which case
§6.1 and §6.2.1 should be amended to say the donor side is in Portal 1 — or
requires FlowPortal to host it, which means deciding first whether a DAS link
made in one portal is visible in the other, or whether a donor maintains two.

---

## D-05 — A guarded manual entry path for levy figures

**Criterion.**

- F1.1.1 AC2 (Real-Time Levy Balance Display), Must Have, Phase 1: "Balance is
  sourced directly from ESFA DAS API — no manual entry permitted". The
  feature's description adds that the balance is "synced live from the ESFA DAS
  API" and "must reflect the most recent DAS transaction data".

**What the build does instead.** The platform ships a deliberate manual entry
path at `POST /api/v1/das/manual/*`, covering the levy balance, monthly
contributions and spend, expiry tranches, funding payments, ILR receipts and
donor links. It is guarded three ways — authenticated, an active organisation,
and `OWNER` or `ADMIN` role only — every write is attributed to the user who
made it and audited (`DasLevyBalance`, `DasLevyMonthlyEntry`,
`DasFundingPayment`, `DasDonorLink` and `DasLevyTranche` are all in the
audited set), and hand-entered data is marked as such wherever it appears: the
balance carries `lastSyncStatus = manual` and the employer screens say the
figures "appear on the levy dashboard and in your reports exactly as a live
sync would, marked as manually entered".

**Why.** There is no ESFA DAS connection. The API the criterion names is not
available to the platform, so the alternative to manual entry is not a live
balance — it is no balance, and with it no levy dashboard, no expiry alerts,
no funding reconciliation and no ROI reporting. Every one of those is a Phase 1
Must Have that depends on figures the platform cannot otherwise obtain. The
deviation buys a working Phase 1 at the cost of the provenance guarantee, and
the marking exists so that nobody reads a hand-entered figure as an ESFA one.

**Scope.** F1.1.1 AC2 only. The rest of F1.1.1 is unaffected: the balance is
still shown in GBP to two decimal places, still carries a last-synced
timestamp, and the degraded-mode banner still applies when a configured sync
fails. Manual entry does not disable the sync path — it fills the same fields
the sync would.

**Accepted by, and when.** Accepted by the client. The acceptance predates
this record and is not minuted in either repository, so it carries no date or
signatory here — see the note below.

**Reversed when.** An ESFA DAS connection exists. At that point the manual
endpoints should become unavailable, or be restricted to correcting a failed
sync, and `lastSyncStatus = manual` should stop appearing on new data.

---

## A note on where acceptances are recorded

Three of these five records have no minuted acceptance to cite, because
`DECISIONS-FOR-CLIENT.md`, `OPEN_QUESTIONS.md`, `PROJECT-STATUS.md` and
`WORKFLOW.md` — the four documents `CLAUDE.md` names as the homes for client
decisions, risks, status and process — **do not exist in either repository**.
D-03 cites "DECISIONS-FOR-CLIENT.md question 17" and
`data-retention.service.ts` cites the same question; neither reference
resolves.

The consequence for QA is specific: "accepted by the client" in D-05 and
"agreed at the close-out" in D-02 are recorded here on the authority of the
brief that asked for these records, and nowhere else. Either those four
documents should be created and the acceptances minuted in them, or this file
should carry the name and date against each record. As it stands a deviation
and an undiscovered gap look the same from outside.
