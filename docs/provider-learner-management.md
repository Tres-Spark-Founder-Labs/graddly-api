# Provider learner management (Phase 6)

Provider-portal APIs for cohort dashboard, at-risk intervention queue, and individual learner profiles.

**PRD:** [04-provider-portal.md](prd/04-provider-portal.md) — F2.2.1 (cohort), F2.2.2 (intervention queue), F2.2.4 (profile).

All routes require `Authorization: Bearer <token>` and an active **provider** organisation (`X-Organisation-Id` optional override).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/learners/cohort` | Paginated cohort table + optional CSV export |
| `GET` | `/api/v1/learners/intervention-queue` | Severity-sorted at-risk queue + `atRiskCount` |
| `POST` | `/api/v1/learners/:enrolmentId/interventions` | Log intervention action |
| `GET` | `/api/v1/learners/:enrolmentId/profile` | Single-call learner profile aggregate |

Apprentice document library remains at `GET /api/v1/learners/me/documents` ([learner-documents.md](learner-documents.md)).

## Cohort dashboard

**Columns:** learner name, employer, standard, start date, OTJ %, next review date, EPA date, status badge, tutor.

**Filters:** `employerOrganisationId`, `standardId`, `statusBadge`, `tutorUserId`, `epaMonth` (YYYY-MM).

**Sort:** `sortBy` (column name) + `sortOrder` (`asc` / `desc`).

**Export:** `?format=csv` returns `text/csv` attachment with all matching rows (pagination meta reflects total count).

### Status badge precedence

1. `withdrawn` — apprentice withdrawn or enrolment cancelled  
2. `break_in_learning` — apprentice paused  
3. `epa_ready` — gateway checklist 100%  
4. `overdue` — scheduled review not completed 3+ days after `scheduledAt`  
5. `at_risk` — OTJ pace `at_risk` or `off_track`  
6. `on_track` — default  

## Intervention queue

Learners appear when any flag applies:

| Flag | Trigger |
|------|---------|
| `otj_behind` | `otjPaceAlertLevel` is `at_risk` or `off_track` |
| `missed_review` | Scheduled review overdue by PRD 3-day rule |
| `gateway_stalled` | EPA within 90 days and gateway checklist &lt; 100% |

**Severity** (descending): off_track (100) → missed review (85) → gateway stalled (70) → at_risk (50). Tie-break: `daysSinceLastActivity`.

**Filters:** `tutorUserId`, `mine=true` (current user as tutor).

**Actions** (`POST .../interventions`): `contact_made`, `review_scheduled`, `employer_notified`, `escalated`.

## Learner profile

Aggregates: personal details, employer, programme/standard, tutor, full review history (with co-sign state), OTJ % and recent log entries, document library refs (with presigned URLs), message thread IDs, break-in-learning snapshot (`active` when apprentice status is `paused`), and recent intervention actions.

Break-in-learning **write** API (reason, return date, DAS notify) is deferred; profile returns read-only fields for now.

## Related EIF inputs (PRD-011)

Safeguarding checklist and programme documents feed EIF scores — see [ofsted.md](ofsted.md).
