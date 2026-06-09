> Source: Gradlly PRD v1.0 (March 2026). Archived docx: [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx)

## PORTAL 2  ·  PRODUCT REQUIREMENTS

## Provider Portal

Ofsted-ready. ILR-compliant. Every learner, every day.

4. Portal 2 — Provider Portal

## 4.1 Portal Context

## Portal ID

P2

## Target users

Programme Manager, Curriculum Lead, Tutor, Compliance Officer, Quality Manager

## Primary goal

Manage full learner cohorts end-to-end while maintaining Ofsted readiness and ESFA compliance at all times

## Design tone

Clinical, data-dense, compliance-focused. Should feel like a professional operations system: structured, precise, always audit-ready

## Primary colour

#3D52D5 (Indigo) — IBM Plex Sans

## Key integrations

ESFA DAS API (two-way sync); ILR direct submission to ESFA

## Access device

Desktop primary (1280px+), full tablet support

## 4.2 Feature Requirements

4.2.1 Ofsted Readiness Hub

### F2.1.1 F2.1.1

## Live EIF Readiness Score

## Must Have

**Phase:** Phase 1

## Description

- The Ofsted hub must display a live readiness score for every Education Inspection Framework (EIF) criterion, calculated automatically from live platform data including OTJ records, review completion rates, and programme documentation.

**Acceptance criteria**

Each of the 7 core EIF criteria is displayed with an individual score (0–100%) and a RAG (red/amber/green) rating

## Overall readiness percentage is displayed as a ring chart with numeric value

Scores are recalculated every time relevant underlying data changes — not cached for more than 1 hour

Red threshold: below 60% | Amber: 60–79% | Green: 80%+

Historical trend chart is available per criterion showing last 12 months of score movement

If any criterion scores below 75%, a red alert banner is displayed at the top of the hub

### F2.1.2 F2.1.2

Quality Improvement Plan (QIP)

## Must Have

**Phase:** Phase 1

## Description

Providers must be able to create, manage, and track a Quality Improvement Plan within the platform, with actions assigned to named staff members.

**Acceptance criteria**

QIP actions can be created with: title, description, assigned owner (staff member), target completion date, linked EIF criterion, and evidence notes

Action status: not started / in progress / completed / overdue

## Overdue actions are highlighted in red and surfaced at the top of the QIP view

QIP progress (% actions complete) is shown on the Ofsted hub overview

QIP is exportable as PDF in Ofsted-standard format

## Completed actions can have supporting evidence documents attached

### F2.1.3 F2.1.3

Self-Assessment Report (SAR) Auto-Generation

## Should Have

**Phase:** Phase 2

## Description

The system must be able to generate a draft SAR document pre-populated with live platform data, reducing the manual effort of SAR preparation.

**Acceptance criteria**

SAR draft is generated from: EIF scores, QIP progress, learner outcome data, review completion rates, and withdrawal rates

## Generated SAR follows the standard Ofsted SAR template structure

## Draft is editable within the platform and exportable as Word document

Provider can lock the SAR for a given period (e.g. academic year) to create a historical record

### F2.1.4 F2.1.4

## Ofsted Evidence Pack Download

## Must Have

**Phase:** Phase 1

## Description

Providers must be able to download a pre-organised evidence package covering all EIF themes, ready to share with an Ofsted inspector.

**Acceptance criteria**

Evidence pack is organised by EIF theme — one folder per theme

Each folder contains: relevant platform data exports, signed documents, review records, and any manually uploaded evidence

## Pack is downloadable as a single ZIP file

Pack generation completes within 60 seconds for up to 500 learner records

## Provider can add custom documents to the pack before download

4.2.2 Learner Management

### F2.2.1 F2.2.1

## Full Cohort Dashboard

## Must Have

**Phase:** Phase 1

## Description

Providers must have a single-screen view of every learner across all cohorts with real-time status data.

**Acceptance criteria**

Cohort table columns: learner name, employer, standard, start date, OTJ %, next review date, EPA date, status badge, assigned tutor

Sortable by all columns; filterable by employer, standard, status, tutor, EPA month

Status badges: On Track / At Risk / Overdue / Break in Learning / Withdrawn / EPA Ready

Table loads within 2 seconds for up to 1,000 learner records

## Table is exportable as CSV and PDF

"At-risk count" badge shown on the sidebar nav item

### F2.2.2 F2.2.2

At-Risk Intervention Queue

## Must Have

**Phase:** Phase 1

## Description

At-risk learners must surface in a dedicated intervention queue sorted by urgency, enabling tutors to prioritise their caseload effectively.

**Acceptance criteria**

Intervention queue lists all at-risk and overdue learners sorted by severity score (most urgent first)

Each entry shows: learner name, reason for flag (OTJ behind / missed review / gateway stalled), days since last activity, assigned tutor, employer contact

Tutor can log an intervention action directly from the queue: contact made / review scheduled / employer notified / escalated

## Queue updates in real time as underlying data changes

## Tutor can filter queue to their own caseload only

### F2.2.3 F2.2.3

12-Weekly Review Scheduler

## Must Have

**Phase:** Phase 1

## Description

Tutors must be able to schedule, record, and manage 12-weekly progress reviews for all learners, with automated reminders sent to all parties.

**Acceptance criteria**

## Review scheduler shows all upcoming reviews in a calendar and list view

Bulk scheduling: provider can set review dates for multiple learners simultaneously

Automated reminders: email sent to learner, employer, and tutor at 7 days and 1 day before review

Review record is created in-platform during or after the review: SMART goals, progress against previous goals, OTJ discussion, wellbeing check, action points

Review record is co-signed by tutor and learner (e-signature)

## Employer is notified of review outcome summary and can view the full record

Overdue reviews (not completed within 3 days of scheduled date) are flagged in the intervention queue

### F2.2.4 F2.2.4

## Individual Learner Profile

## Must Have

**Phase:** Phase 1

## Description

Each learner must have a complete profile accessible by their assigned tutor and programme manager.

**Acceptance criteria**

Profile contains: personal details, employer details, standard, EPA organisation, tutor, start date, expected end date

## Full review history with all records and signatures

OTJ log view: all sessions submitted, with approval status, tutor can flag entries

Document library: all signed agreements, review records, uploaded evidence

Communication thread: all portal messages between tutor, employer, and learner

Withdrawal / break-in-learning management: provider can record reason, expected return date, and notify DAS

Profile loads within 2 seconds

### F2.2.5 F2.2.5

## Tutor Caseload Management

## Should Have

**Phase:** Phase 1 post-launch

## Description

Programme managers must be able to assign learners to tutors and monitor caseload balance.

**Acceptance criteria**

## Tutor assignment can be set per learner or in bulk for a cohort

Caseload dashboard shows: learner count per tutor, at-risk count per tutor, review compliance rate per tutor

Programme manager receives alert when any tutor's at-risk count exceeds a configurable threshold (default: 5)

## Tutor reassignment is tracked in the audit trail

4.2.3 DAS and ILR Integration

### F2.3.1 F2.3.1

Two-Way DAS Sync

## Must Have

**Phase:** Phase 1

## Description

The provider portal must maintain a live, bidirectional sync with the ESFA Digital Apprenticeship Service API, ensuring that all enrolments, withdrawals, and completions are reflected in real time.

**Acceptance criteria**

DAS sync authenticates via ESFA OAuth 2.0 — no stored passwords

Enrolments created in the platform are pushed to DAS within 5 minutes

Withdrawals and completions recorded in the platform are pushed to DAS within 5 minutes

DAS data (funding status, payment confirmations) is pulled into the platform on each sync cycle

Sync status indicator shows: last sync time, sync health (green / amber / red), and error count

## Manual sync trigger available for programme managers

Full API activity log with each request, response code, and any error messages

### F2.3.2 F2.3.2

## ILR Build and Submission

## Must Have

**Phase:** Phase 1

## Description

Providers must be able to build, validate, and submit their Individualised Learner Record directly to ESFA from within the portal.

**Acceptance criteria**

ILR data is auto-populated from platform learner records — no manual data re-entry

Pre-submission validation checks all required ILR fields against ESFA validation rules

Validation report lists all errors and warnings in plain English with field-level guidance

Provider can correct errors within the platform and re-run validation before submitting

## Submission is made directly to ESFA ILR submission API

Submission confirmation receipt is stored in the portal with timestamp and ESFA reference

Funding claim tracker shows: claimed amount, received amount, any discrepancies, and resolution status

4.2.4 Employer Engagement

### F2.4.1 F2.4.1

## Employer Directory

## Must Have

**Phase:** Phase 1

## Description

Providers must have a directory of all linked employer organisations with key relationship metrics.

**Acceptance criteria**

Directory lists all employer clients with: organisation name, contact name and email, active learner count, average OTJ %, commitment statement pipeline status, last visit date

Filterable by region, learner count, OTJ average

Click-through to employer record showing all learners and correspondence history

### F2.4.2 F2.4.2

## Employer Visit Log

## Should Have

**Phase:** Phase 1 post-launch

## Description

Tutors must be able to record the outcome of employer visits within the portal for Ofsted evidence purposes.

**Acceptance criteria**

Visit log entry includes: date, visit type (on-site / video / phone), attendees, discussion points, action points, next visit date

## Visit records are linked to the relevant employer and learners discussed

## Visit log is exportable as PDF for Ofsted evidence pack

## System suggests next visit date based on visit frequency requirements

### F2.4.3 F2.4.3

## Employer Satisfaction Survey

## Could Have

**Phase:** Phase 2

## Description

Providers must be able to send satisfaction surveys to employer contacts and view aggregated results.

**Acceptance criteria**

Survey templates are configurable with up to 10 questions (Likert scale and free text)

Surveys are sent via email with a unique link — no login required for employer to respond

Results dashboard shows: response rate, average scores per question, NPS score, free-text themes

Results are available 24 hours after survey closes