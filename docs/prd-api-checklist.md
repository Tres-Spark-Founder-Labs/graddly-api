# PRD API checklist (Phase 1 MVP)

Working checklist to close gaps between the PRD (`docs/prd/`) and this API. Frontends consume these endpoints; UI-only acceptance criteria are noted but out of scope here.

**Status key:** `[ ]` not started · `[~]` partial (exists but PRD criteria not met) · `[x]` done

**Task IDs** map to `PROJECT-TASKS.csv` (phase `PRD` for net-new work; engineering phases A–U for foundation).

**Phase 1 MVP scope:** `docs/prd/09-release-phases.md` §10.1

---

## How to use this doc

0. **Follow execution order** in [prd-api-implementation-plan.md](./prd-api-implementation-plan.md) — phases 1–11, one PR per phase.
1. Pick a row by priority (P0 → P1 → P2) or by the active phase in the implementation plan.
2. Implement API + migration + **detailed Swagger** + unit specs + e2e route.
3. Mark the checkbox and update `PROJECT-TASKS.csv` status.
4. Link PR / commit to the `task_id`.
5. Update the phase row in the implementation plan progress tracker.

---

## Summary

| Priority | Open items | Notes |
|----------|------------|-------|
| P0 | 8 | Blocks MVP compliance or entire portal slices |
| P1 | 10 | Core portal features with partial backend today |
| P2 | 6 | Automation, aggregates, ops polish |
| Foundation `[~]` | 14 | Engineering phases done but PRD criteria incomplete |

---

## P0 — Must ship for MVP

### ESFA / DAS integration

- [x] **PRD-001** · DAS enrolment submission push  
  - **PRD:** `07-integrations.md` §8.1 — within 5 minutes of ILR creation  
  - **Gap:** Only withdrawal push exists (`withdrawal-push/`). No enrolment push.  
  - **Deliver:** Queue job on ILR learner record create/submit → DAS API; status entity; retry/DLQ.  
  - **Depends:** Live DAS client (`DAS-001` partial)

- [x] **PRD-004** · ILR official XML + live ESFA client  
  - **PRD:** F2.3.1–2 · `07-integrations.md`  
  - **Gap:** `ILR_ESFA_PROVIDER=noop` default; JSON REST stub only (`ilr-payload-serializer.service.ts`).  
  - **Deliver:** XML serializer; configure http ESFA client; receipt persistence; e2e with mock ESFA.  
  - **Related:** `[~]` ILR-003

- [ ] **PRD-016** · FlowPortal Module C — AI apprenticeship programmes  
  - **PRD:** F4.4.1, F4.4.2, F4.4.3 (Phase 1 Must Have per `09-release-phases.md`)  
  - **Gap:** No modules, entities, or routes.  
  - **Deliver (minimum API surface):** Programme catalogue, learner enrolment on AI track, progress/completion records scoped to FlowPortal orgs. Align entity design with `08-data-model.md` before coding.

- [ ] **PRD-007** · Apprentice EPA evidence pack export  
  - **PRD:** F3.3.4  
  - **Gap:** Provider Ofsted ZIP job exists (`ofsted/evidence-pack-jobs`); not apprentice EPA pack.  
  - **Deliver:** `POST /portfolio/epa-pack-jobs` (or similar) → async PDF/ZIP compiling accepted evidence, KSB summary, reviews, OTJ summary, commitment PDF; poll + download URL.

### FlowPortal onboarding

- [ ] **PRD-014** · Levy eligibility checker (anonymous)  
  - **PRD:** F4.2.1  
  - **Gap:** No public endpoint.  
  - **Deliver:** `POST /levy-exchange/eligibility/check` (no auth) — size, sector, region, DAS account flag → eligible / not eligible / advisor + estimated funding band.

- [ ] **PRD-015** · ESFA registration wizard API  
  - **PRD:** F4.2.2  
  - **Gap:** No multi-step wizard or progress persistence.  
  - **Deliver:** Wizard session entity; step endpoints (Companies House verify, PAYE, DAS creation status, bank details, consent); resume token; confirmation email hook.

### Apprentice journey

- [ ] **PRD-008** · Programme timeline + gateway checklist + EPA date  
  - **PRD:** F3.2.1, F3.2.2, F3.2.3  
  - **Gap:** No `epaDate`, milestones, or gateway criteria models.  
  - **Deliver:**  
    - Migration: `epaDate` on enrolment (or milestone table).  
    - Gateway criteria per standard (seed from standard metadata).  
    - `GET /enrolments/:id/journey` — timeline milestones + checklist + days-to-EPA.  
    - Notify provider when checklist 100% (F3.2.2).

- [ ] **PRD-006** · OTJ smart pace alerts (PRD-accurate)  
  - **PRD:** F3.1.4  
  - **Gap:** `[~]` OTJ-003 uses 30-day approved minutes (`otj-pace.service.ts`), not 15%/30% behind EPA-target pace; no alert notifications.  
  - **Deliver:** Pace calculator vs planned OTJ target by EPA date; persist alert level; create in-app notifications; optional email via existing notification pipeline.

---

## P1 — Core portal completeness

### Provider (Portal 2)

- [ ] **PRD-009** · At-risk intervention queue  
  - **PRD:** F2.2.2  
  - **Gap:** No queue entity or endpoints.  
  - **Deliver:** `GET /learners/intervention-queue` (severity sort); `POST .../:enrolmentId/interventions` (contact made / review scheduled / employer notified / escalated); wire overdue reviews + OTJ off_track.

- [ ] **PRD-010** · Learner cohort dashboard API  
  - **PRD:** F2.2.1  
  - **Gap:** `[~]` `employer-directory` + raw `enrolments` list — not unified learner table.  
  - **Deliver:** `GET /learners/cohort` — columns: name, employer, standard, start, OTJ %, next review, EPA date, status badge, tutor; filters; CSV export endpoint.

- [ ] **PRD-021** · Individual learner profile (aggregate)  
  - **PRD:** F2.2.4  
  - **Deliver:** `GET /learners/:enrolmentId/profile` — personal, employer, standard, tutor, reviews, OTJ, document refs, message thread IDs, break-in-learning actions.

- [ ] **PRD-011** · EIF real inputs (remove stubs)  
  - **PRD:** F2.1.1  
  - **Gap:** `[~]` EIF-001 — `safeguarding_stub` (70%) and `programme_docs_stub` (75%) in `eif-score-calculator.service.ts`.  
  - **Deliver:** Real safeguarding + programme document coverage metrics; update `eif-criteria.v1.json`.

### Employer (Portal 1)

- [ ] **PRD-012** · Levy utilisation history + cost-per-apprentice  
  - **PRD:** F1.1.3  
  - **Gap:** Forecast exists (`GET /das/levy-forecast`); no monthly contribution/spend series or cost-per-apprentice table.  
  - **Deliver:** Persist DAS transaction/contribution history on sync; `GET /reporting/levy-utilisation` with 12-month series + segments (used / expiring / available) + cost table.

- [ ] **PRD-003** · Enrolment pipeline sub-states  
  - **PRD:** F1.2.x · `01-platform.md` §2.4  
  - **Gap:** `[~]` DOM-003 — only draft/active/completed/cancelled.  
  - **Deliver:** Track invited → account_created → provider_accepted → ilr_created → das_confirmed (computed or explicit enum); expose on enrolment DTO + transition hooks.

- [ ] **PRD-018** · Auto-provision apprentice user on enrolment  
  - **PRD:** `01-platform.md` §2.4  
  - **Gap:** Invitation flow only.  
  - **Deliver:** On enrolment activate (or create), invite or provision apprentice portal user + link to apprentice record.

### FlowPortal (Portal 4)

- [ ] **PRD-017** · SME dashboard aggregate  
  - **PRD:** F4.3.1  
  - **Deliver:** `GET /reporting/sme-overview` — active count, pending OTJ approvals, reviews due, commitment pipeline counts; apprentice list with OTJ %.

### Apprentice (Portal 3)

- [ ] **PRD-020** · Document library aggregate  
  - **PRD:** F3.4.3 · F2.2.4  
  - **Deliver:** `GET /learners/me/documents` — signed commitments, review PDFs, evidence items (metadata + download URLs).

- [ ] **PRD-024** · Apprentice review 48h reminder  
  - **PRD:** F3.2.4  
  - **Gap:** `[~]` REV-002 — 7d/1d only (`ReviewReminderKind`).  
  - **Deliver:** Add `48h` kind + cron dispatch to apprentice.

### ESFA (continued)

- [x] **PRD-002** · DAS completion notification push  
  - **PRD:** `07-integrations.md` §8.1  
  - **Deliver:** Queue on enrolment completion + EPA outcome; mirror withdrawal-push pattern.

- [x] **PRD-005** · ILR async submit BullMQ  
  - **PRD:** Production reliability  
  - **Gap:** `[~]` ILR-003 — synchronous submit in v1.  
  - **Deliver:** `ilr-submit` queue + processor + DLQ; idempotent submit/amend.

- [ ] **PRD-013** · DAS funding payment confirmation sync  
  - **PRD:** `07-integrations.md` §8.1 — daily batch  
  - **Deliver:** Daily cron + `das_funding_payments` table; expose summary on SME/employer reporting APIs.

---

## P2 — Automation, reminders, ops

- [ ] **PRD-019** · Commitment unsigned chase (7-day)  
  - **PRD:** F1.3.x, F3.4.1, F4.3.2  
  - **Deliver:** Cron scans unsigned parties; email + in-app notification per role.

- [ ] **PRD-023** · Weekly OTJ digest email content  
  - **PRD:** F3.1.4 (7-day no-log nudge) · `[~]` NOTIF-005 skeleton  
  - **Deliver:** Wire `digest.processor.ts` to compile per-org/per-apprentice summary; enqueue from `digest-cron.service.ts`.

- [ ] **PRD-022** · Production cron defaults + documentation  
  - **PRD:** F1.1.1 (15m DAS), NFR background jobs  
  - **Gap:** `CRON_DAS_SYNC_ENABLED`, `CRON_OTJ_PACE_ENABLED`, `CRON_REVIEW_REMINDERS_ENABLED`, `CRON_RETENTION_ENABLED` default `false`.  
  - **Deliver:** Document required production env in `secrets-checklist.md`; consider `true` defaults when `NODE_ENV=production`.

- [ ] **Push notification channel** (no PRD task ID yet)  
  - **PRD:** F3.1.4 — push if no OTJ in 7 days  
  - **Gap:** No FCM/APNs/web-push module.  
  - **Deliver:** Device token entity + send adapter; defer native apps but expose registration API for future clients.

- [ ] **GDP-001 completion** · Data retention operator visibility  
  - **Gap:** `[~]` cron disabled by default; no HTTP API.  
  - **Deliver:** Optional `GET /platform/retention/runs` (ops key) or document worker-only operation.

- [ ] **PERF-001 completion** · Load-test sign-off  
  - **Gap:** `[~]` k6 smoke only.  
  - **Deliver:** Run staging checklist in `docs/performance.md`; record results in repo or CI artifact.

---

## Foundation already built `[x]` — no PRD gap work

These engineering phases are **Done** in `PROJECT-TASKS.csv`:

Auth/OIDC, orgs, RBAC, invitations, BullMQ core, notifications (in-app + Resend email), storage, audit, PDF, e-signature, programmes/apprentices/enrolments CRUD, OTJ CRUD + approval, reviews + co-sign + PDF, commitments, portfolio/KSB, messaging, levy exchange (assisted matching), ILR mapping/validation, EIF/QIP/Ofsted pack, reporting (employer directory, ROI stub), GDPR erasure, Helmet/CSP, CI, QA epic.

---

## Foundation partial `[~]` — fix via PRD tasks above

| Task ID | Area | Fix via |
|---------|------|---------|
| DOM-003 | Enrolment states | PRD-003 |
| DAS-001/003/004/005 | DAS client + crons + push | PRD-001, PRD-002, PRD-013, PRD-022 |
| OTJ-003 | Pace flags | PRD-006, PRD-023 |
| REV-002 | Reminders | PRD-024, PRD-009 |
| ILR-003 | ESFA submit | PRD-004, PRD-005 |
| EIF-001 | Stub metrics | PRD-011 |
| NOTIF-005 | Digest skeleton | PRD-023 |
| RPT-001 | ROI stubs | PRD-012 (utilisation); EPA metrics when EPA outcomes entity exists |
| LEX-004 | Live DAS transfer | Production DAS config + verify transfer submit |
| DLQ-001 | DLQ pattern | Extend to ILR submit + digest queues when added |
| GDP-001 | Retention | P2 ops item |
| PERF-001 | Load tests | P2 ops item |

---

## PRD feature → API mapping (Phase 1 Must Haves)

Quick reference for sprint planning. **Done** = API supports PRD intent for v1; **Partial** = endpoints exist, acceptance criteria not met; **Missing** = no API.

### Portal 1 — Employer

| PRD | Feature | API status | Checklist |
|-----|---------|------------|-----------|
| F1.1.1 | Real-time levy balance | Partial | PRD-022, live DAS |
| F1.1.2 | Expiry alerts | Partial | Crons exist; enable in prod |
| F1.1.3 | Utilisation chart | Partial | PRD-012 |
| F1.2.1–5 | Apprentice tracking | Partial | PRD-003, PRD-010 |
| F1.3.1–3 | Commitments | Partial | PRD-019 |

### Portal 2 — Provider

| PRD | Feature | API status | Checklist |
|-----|---------|------------|-----------|
| F2.1.1 | EIF readiness | Partial | PRD-011 |
| F2.1.2 | QIP | Done | — |
| F2.1.4 | Evidence pack | Done | Provider Ofsted ZIP |
| F2.2.1 | Cohort dashboard | Partial | PRD-010 |
| F2.2.2 | Intervention queue | Missing | PRD-009 |
| F2.2.3 | Review scheduler | Partial | PRD-024, PRD-009 |
| F2.2.4 | Learner profile | Partial | PRD-021 |
| F2.3.1–2 | ILR | Partial | PRD-004, PRD-005, PRD-001 |
| F2.4.1 | EIF dashboard | Partial | PRD-011 |

### Portal 3 — Apprentice

| PRD | Feature | API status | Checklist |
|-----|---------|------------|-----------|
| F3.1.1–3 | OTJ log/history | Done | — |
| F3.1.4 | Smart pace alerts | Partial | PRD-006, PRD-023 |
| F3.2.1–3 | Timeline/gateway/EPA | Missing | PRD-008 |
| F3.2.4 | Review history | Partial | PRD-024, PRD-020 |
| F3.3.1–2 | Portfolio/heatmap | Done | — |
| F3.3.4 | EPA evidence pack | Missing | PRD-007 |
| F3.4.1–2 | Commitments/messaging | Partial / Done | PRD-019 |
| F3.4.3 | Document library | Missing | PRD-020 |

### Portal 4 — FlowPortal

| PRD | Feature | API status | Checklist |
|-----|---------|------------|-----------|
| F4.1.1–2 | Donor DAS + surplus | Done | Live DAS config |
| F4.2.1 | Eligibility checker | Missing | PRD-014 |
| F4.2.2 | Registration wizard | Missing | PRD-015 |
| F4.2.3 | Matching | Done | Assisted mode OK |
| F4.2.4 | Onboarding concierge | N/A API | Ops/process |
| F4.3.1 | SME overview | Partial | PRD-017 |
| F4.3.2 | Commitments | Partial | PRD-019 |
| F4.3.4 | SME concierge | N/A API | Ops/process |
| F4.4.1–3 | AI programmes | Missing | PRD-016 |

---

## Implementation order

**Superseded by [prd-api-implementation-plan.md](./prd-api-implementation-plan.md)** — see phases 1–11 there for canonical execution order, dependencies, and progress tracking.

---

## Document control

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-05-28 | Initial checklist synced with gap analysis + PROJECT-TASKS.csv PRD phase |
| 1.1 | 2026-06-09 | Link to prd-api-implementation-plan.md; supersede inline suggested order |
