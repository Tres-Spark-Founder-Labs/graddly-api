# Deviations from the PRD

Places where the build knowingly does something the PRD does not specify,
recorded so that the PRD's vocabulary is not widened silently. Each one needs
the client's confirmation; until it is given, the PRD text stands and the
deviation is the build's proposal.

| ID   | Feature and criterion      | Deviation                                                                                                          | Status                                                              |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| D-01 | F2.2.1 AC3, F1.2.1 AC3     | A grey "Pace unknown" status badge                                                                                 | Awaiting client confirmation                                        |
| D-03 | F2.3.2 AC1, AC2, AC5; §8.2 | The ILR carries a v1 field subset, two validation rules, a stub ESFA client, and a file download for manual upload | Awaiting client decision: Phase 1 with the gap declared, or Phase 2 |

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
  funding-model-36 apprenticeship learner needs. Two of the nine are wrong:
  `LearnAimRef` holds the standard's code where ESFA expects `ZPROG001`, and
  dates are written `YYYYMMDD` where the XML schema expects `YYYY-MM-DD`. ULN
  is entered by hand. The full list of what is missing, and what closing each
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
   and the three v1 fixes (`LearnAimRef`, date format, serial number).
2. ESFA's validation rules and XSD applied before a file is offered or sent.
3. A decided submission route. Either a real ESFA integration, if one exists
   for third parties, or the client accepting file upload to Submit Learner
   Data as the route, which would amend AC5 and §8.2.

**Decision needed.** Whether F2.3.2 ships in Phase 1 with this gap declared, or
moves to Phase 2.
