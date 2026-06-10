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
| `epaDate` / `daysToEpa` / `epaCountdownBand` | EPA countdown (green >90d, amber 30–90d, red <30d) |
| `pace` | OTJ pace snapshot vs EPA target |

`PATCH /api/v1/enrolments/:id/journey` — set `epaDate` (YYYY-MM-DD).

When `gatewayReady` becomes true for the first time, provider org admins receive an in-app notification (`action: gateway_ready`).

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
