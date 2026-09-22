# Deviations from the PRD

Places where the build knowingly does something the PRD does not specify,
recorded so that the PRD's vocabulary is not widened silently. Each one needs
the client's confirmation; until it is given, the PRD text stands and the
deviation is the build's proposal.

| ID   | Feature and criterion  | Deviation                          | Status                       |
| ---- | ---------------------- | ---------------------------------- | ---------------------------- |
| D-01 | F2.2.1 AC3, F1.2.1 AC3 | A grey "Pace unknown" status badge | Awaiting client confirmation |

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
