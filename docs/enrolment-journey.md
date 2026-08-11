# Apprentice journey + OTJ smart pace

Programme timeline, gateway checklist, EPA countdown (PRD-008) and EPA-target OTJ pace alerts (PRD-006).

## Journey API

`GET /api/v1/enrolments/:id/journey`

Returns:

| Field | Description |
|-------|-------------|
| `milestones` | Chronological programme stages (enrolment → induction → reviews → gateway → EPA → completion) |
| `gatewayChecklist` | Standard-specific criteria with status (`complete` / `not_started` / `blocked`) |
| `gatewayCompletionPercent` | 0–100 checklist progress |
| `gatewayReady` | `true` when all criteria complete |
| `gatewayReadyAt` | When readiness was reached; `null` whenever not currently ready |
| `epaDate` / `daysToEpa` / `epaCountdownBand` | EPA countdown — see bands below |
| `pace` | OTJ pace snapshot vs EPA target |

`PATCH /api/v1/enrolments/:id/journey` — set `epaDate` (YYYY-MM-DD).

## Timeline milestones (client decision Q2)

Review milestones are sourced from the reviews that **actually exist** on the
enrolment, not from a schedule derived from the start date. A late, rescheduled
or missed review therefore appears as it really is. The timeline is untidier for
it, and that is the point — the untidiness is the signal that something slipped.

`JourneyMilestoneStatus` values for a review:

| Status | When |
|---|---|
| `complete` | Review status is `completed`, however late it was held |
| `cancelled` | Review status is `cancelled` |
| `overdue` | Scheduled date has passed and the review is neither completed nor cancelled |
| `upcoming` | Scheduled in the future |
| `current` | Applied to the first upcoming milestone in the whole timeline |

`overdue` and `cancelled` were added by decision Q2. Before it, every review
that was not completed or cancelled reported as `current` (so several reviews
were simultaneously "current"), and a *cancelled* review reported as `upcoming`.

## EPA countdown bands (client decision Q4)

Arithmetic lives in `src/enrolments/epa-countdown.ts` as pure functions, tested
on both sides of every boundary in `epa-countdown.spec.ts`.

| `epaCountdownBand` | When |
|---|---|
| `green` | 90 days or more remaining |
| `amber` | 30 to 89 days |
| `red` | 29 days or fewer, **including the day of the EPA itself** |
| `overdue` | EPA date has passed with no completion recorded |
| `unset` | Provider has not confirmed an EPA date (F3.2.3 AC3) |

The PRD's prose ("green >90 / amber 30–90 / red <30") does not partition the
range — days 90 and 30 each appear twice. The table above is the client's
decision, and it corrected an off-by-one: day 90 previously fell into amber.

`daysToEpa` stays truthful and goes negative once the date has passed; `band`
is what clients switch on, so an overdue EPA is not rendered as a countdown
running backwards.

## Gateway readiness as a recorded moment (client decision Q3)

Readiness is recorded, not recomputed and forgotten:

- **`gatewayReadyAt`** — when readiness was reached.
- **`gatewayReadyNotifiedAt`** — whether the provider has been told.

Two columns rather than one, so a notification dispatch that throws leaves
readiness recorded and is retried on the next read.

When `gatewayReady` first becomes true, provider org owners and admins receive
an in-app notification (`action: gateway_ready`).

**Readiness can lapse (Q3a).** If a criterion is later withdrawn or
invalidated, both columns clear and the badge disappears — the response
describes the current position, not a high-water mark.

**Regaining readiness re-notifies (Q3b).** Because the lapse clears the
notification marker too, a second readiness sends a fresh notification. If the
first notification led to no action because readiness lapsed, only a second one
reopens it.

> **Known limitation.** This reconciliation runs on read. Nothing observes
> readiness until someone opens the journey, so `gatewayReadyAt` records when
> readiness was first *seen*, not when the last criterion was met. Closing that
> gap needs a sweep like `otj-pace-cron.service.ts`; tracked in
> `OPEN_QUESTIONS.md`.

## Gateway criteria

Stored on `standards.gatewayCriteria` (JSON array). When unset, defaults:

- `otj_on_track` — pace alert `on_track` or `at_risk`
- `commitment_signed` — current commitment `signed`
- `reviews_current` — no overdue incomplete reviews
- `epa_date_confirmed` — `enrolment.epaDate` set

## OTJ smart pace (PRD F3.1.4)

Nightly cron (`CRON_OTJ_PACE_ENABLED`) evaluates each active enrolment:

1. **Target** — `plannedDurationMonths × 20h/month` (20% OTJ rule)
2. **Expected by today** — linear proportion from programme start → EPA date
3. **Behind %** — `(expected − approved) / expected × 100`
4. **Alert level** — `on_track` (≤15%), `at_risk` (>15%), `off_track` (>30%)

Persisted on `enrolments.otjPaceAlertLevel`. In-app `OTJ` notifications go to `apprenticeUserId` when entering or weekly-recurring at `at_risk` / `off_track`.

Approved log entries inherit `paceFlag` for EIF/reporting compatibility.

## Related modules

- `src/enrolments/enrolment-journey.service.ts`
- `src/otj/otj-pace-calculator.ts`
- `src/otj/otj-pace.service.ts`
- `src/scheduler/otj-pace-cron.service.ts`
