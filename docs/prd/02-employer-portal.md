> Source: Gradlly PRD v1.0 (March 2026). Archived docx: [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx)

## PORTAL 1  ·  PRODUCT REQUIREMENTS

## Employer Portal

Manage your levy. Track every apprentice. Prove the ROI.

3. Portal 1 — Employer Portal

## 3.1 Portal Context

## Portal ID

P1

## Target users

Head of L&D, HR Manager, Finance Director, Line Manager

## Primary goal

Manage the entire apprenticeship investment — levy balance, apprentice progress, commitment statements, and ROI — from a single dashboard

## Design tone

Professional, financial, data-driven. Should feel like a best-in-class finance dashboard: precise, trustworthy, always current

## Primary colour

#1847D4 (Blue) — Bricolage Grotesque

## Key integration

ESFA DAS API — real-time levy balance, enrolment status, and payment confirmations

## Access device

Primarily desktop (1280px+), responsive tablet support required

## 3.2 Feature Requirements

3.2.1 Levy Management Dashboard

### F1.1.1 F1.1.1

Real-Time Levy Balance Display

## Must Have

**Phase:** Phase 1

## Description

- The levy dashboard must display the employer's current available levy balance, synced live from the ESFA DAS API.

- The balance must reflect the most recent DAS transaction data and update automatically on each page load and every 15 minutes via background sync.

**Acceptance criteria**

Available levy balance is displayed in GBP with two decimal places on dashboard load

Balance is sourced directly from ESFA DAS API — no manual entry permitted

Last-synced timestamp is displayed alongside the balance value

If DAS API is unavailable, a degraded-mode banner is shown with the last known balance and sync time

Balance updates automatically without page reload every 15 minutes

### F1.1.2 F1.1.2

## Levy Expiry & Funds at Risk Alert

## Must Have

**Phase:** Phase 1

## Description

- The system must identify levy funds that will expire within 90 days and surface a prominent amber warning banner at the top of the levy dashboard.

- Funds expiring within 30 days must trigger a red danger alert.

**Acceptance criteria**

Amber alert banner appears when any portion of levy balance will expire within 90 days

Red alert banner appears when any portion will expire within 30 days

## Alert displays the exact amount at risk and the expiry date

Alert links directly to the Levy Transfer Hub (F1.1.4) with one click

Alert is dismissible per session but re-appears on next login

### F1.1.3 F1.1.3

## Levy Utilisation Chart & Forecast

## Must Have

**Phase:** Phase 1

## Description

The levy dashboard must include a visual utilisation chart showing levy spend breakdown and a 12-month spend forecast based on active apprenticeship programmes.

**Acceptance criteria**

Annual utilisation chart shows three segments: used / expiring within 90 days / available

Monthly bar chart shows contribution vs. spend for the last 12 months

Forecast card projects estimated spend over next 12 months based on active programmes and monthly contribution rate

Cost-per-apprentice table is available showing average cost by standard and provider

## All charts are exportable as PNG and included in the PDF report export

### F1.1.4 F1.1.4

## Levy Transfer Hub

## Should Have

**Phase:** Phase 1 post-launch

## Description

- Employers must be able to initiate levy transfers to SME partner organisations directly from the employer portal, subject to the ESFA 50% transfer cap.

- The Transfer Hub connects to FlowPortal (P4) for SME matching.

**Acceptance criteria**

Employer can see their current transferable balance (up to 50% of annual levy contribution)

Employer can search or browse SME recipients by sector, region, and programme type

## Transfer initiation triggers ESFA DAS API transfer consent flow

Transfer status is tracked in a pipeline view: initiated / pending ESFA / confirmed / active

Compliance documentation is auto-generated for each confirmed transfer

Link to FlowPortal Levy Exchange (P4) is surfaced for automated donor-SME matching

### F1.1.5 F1.1.5

## Levy Report Export

## Must Have

**Phase:** Phase 1

## Description

Employers must be able to export a board-ready levy summary report as a PDF at any time.

**Acceptance criteria**

PDF export includes: available balance, monthly contributions (12 months), utilisation breakdown, forecast, active apprentice count, and cost summary

## Report is branded with Gradlly and employer name/logo

Export is generated in under 10 seconds

Report can be emailed to a configurable list of recipients on a scheduled monthly basis

3.2.2 Apprentice Management

### F1.2.1 F1.2.1

All-Apprentice Overview Dashboard

## Must Have

**Phase:** Phase 1

## Description

Employers must have a single-screen view of every active apprentice across all training providers, showing real-time OTJ progress, EPA dates, and risk status.

**Acceptance criteria**

All active apprentices are listed in a sortable, filterable data table

Table columns: name, standard, provider, OTJ progress %, EPA date, status badge, last activity date

Status badges: On Track (green) / At Risk (amber) / Overdue (red) / EPA Ready (blue)

Filters available: provider, standard, status, EPA month, cohort start date

## Search by apprentice name or employee ID

## Table is exportable as CSV and PDF

Table loads within 2 seconds for up to 500 apprentices

### F1.2.2 F1.2.2

## Individual Learner Profile

## Must Have

**Phase:** Phase 1

## Description

Clicking any apprentice in the overview table must open a detailed learner profile showing the complete apprenticeship record.

**Acceptance criteria**

Profile contains: personal details (name, start date, standard, provider, tutor, line manager)

## Full programme timeline from enrolment to EPA with milestone completion status

## OTJ hours chart showing weekly logged hours over the programme lifetime

Complete review history with dates, outcomes, and action points

Document library: all signed agreements, review records, and correspondence

## Direct messaging thread to tutor and apprentice

Profile loads within 2 seconds

### F1.2.3 F1.2.3

## OTJ Log Approval Workflow

## Must Have

**Phase:** Phase 1

## Description

Line managers must be able to approve or reject OTJ log entries submitted by their apprentices directly within the Employer Portal. A weekly digest email drives managers to the approval queue.

**Acceptance criteria**

OTJ approval queue lists all pending entries with: apprentice name, activity description, category, hours, submission date, and any attached evidence

## Manager can approve or reject each entry individually

Rejection requires a mandatory comment (minimum 10 characters)

Bulk approve is available for up to 20 entries simultaneously

Approved entries update the apprentice's OTJ total in real time in Portal 3

Weekly email digest is sent every Monday at 08:00 GMT listing pending approvals

Manager can configure digest frequency: daily / weekly / off

## All approval actions are timestamped and stored in the audit trail

### F1.2.4 F1.2.4

At-Risk Automated Flagging

## Must Have

**Phase:** Phase 1

## Description

The system must automatically identify apprentices at risk of not meeting their OTJ target and alert the employer within 24 hours of the threshold being breached.

**Acceptance criteria**

System calculates required OTJ pace for each apprentice based on programme duration and hours logged to date

At-risk flag triggers when actual OTJ pace falls more than 15% behind required pace

Overdue flag triggers when OTJ pace falls more than 30% behind required pace

Email notification sent to line manager within 24 hours of flag being set

At-risk badge appears on the apprentice overview table and on the individual profile

Provider (P2) is simultaneously notified via their at-risk intervention queue

### F1.2.5 F1.2.5

## New Apprentice Enrolment

## Must Have

**Phase:** Phase 1

## Description

Employers must be able to initiate the enrolment of a new apprentice from within the portal, linking the apprentice to an apprenticeship standard and a training provider.

**Acceptance criteria**

Employer can create a new apprentice profile by entering: name, email, employee ID, job title, line manager, start date, and apprenticeship standard

Employer selects the training provider from a list of linked providers (provider must have accepted connection request)

System sends a magic-link invitation email to the apprentice to create their Portal 3 account

System notifies the provider (P2) of the new enrolment pending their acceptance

Enrolment status is tracked: invited / account created / provider accepted / ILR created / DAS confirmed

3.2.3 Commitment Statements

### F1.3.1 F1.3.1

## Commitment Statement Status Board

## Must Have

**Phase:** Phase 1

## Description

Employers must have a single view of the commitment statement status for every apprentice, with clear indication of which statements require their signature.

**Acceptance criteria**

Status board lists all apprentices with columns: name, provider, statement version, employer status, apprentice status, provider status

Status values per party: Signed (green) / Pending (amber) / Not sent (grey)

## Statements requiring employer signature are highlighted and sorted to the top

Employer can filter by status, provider, and standard

"Statements requiring action" count is shown as a badge on the sidebar navigation item

### F1.3.2 F1.3.2

Commitment Statement E-Signature

## Must Have

**Phase:** Phase 1

## Description

Employers must be able to review and e-sign commitment statements within the portal. The e-signature must be legally binding and compliant with eIDAS regulations.

**Acceptance criteria**

Employer can view the full commitment statement text in the portal before signing

E-signature captured via drawn signature or typed name with confirmation checkbox

Signed PDF is generated immediately with timestamp, IP address, and signatory metadata

All three parties (employer, provider, apprentice) are notified when the statement is fully executed

## Version history shows all prior versions with dates and signatories

Signed PDF is accessible in the employer document library and the apprentice document library (P3)

### F1.3.3 F1.3.3

## Commitment Statement Audit Trail

## Must Have

**Phase:** Phase 1

## Description

A complete, immutable audit trail for every commitment statement must be maintained and exportable for Ofsted evidence purposes.

**Acceptance criteria**

Audit trail records: creation event, each view, each edit, each signature action, and any version changes

Each entry includes: user name, role, timestamp, and action description

Audit trail is exportable as PDF in Ofsted-ready format

Audit trail cannot be deleted or modified — immutable once written

3.2.4 Reporting & ROI

### F1.4.1 F1.4.1

## Levy ROI Report

## Should Have

**Phase:** Phase 1 post-launch

## Description

Employers must be able to generate a levy ROI report that connects levy spend to apprenticeship outcomes, supporting board-level investment decisions.

**Acceptance criteria**

ROI report includes: total levy spend to date, active apprentice count, completions, EPA pass rate, average cost per completion, estimated productivity uplift

## Report compares outcomes across providers and standards side by side

Year-on-year comparison available where historical data exists

## Report is exportable as PDF and formatted for board presentation

## Scheduled monthly email delivery to configurable recipients

### F1.4.2 F1.4.2

## Provider Performance Comparison

## Should Have

**Phase:** Phase 1 post-launch

## Description

Employers with multiple linked training providers must be able to compare provider performance on key metrics.

**Acceptance criteria**

Comparison table includes per-provider: active learner count, average OTJ completion %, review compliance rate, EPA pass rate, withdrawal rate

Metrics are calculated from live platform data — not self-reported by providers

## Comparison is exportable as CSV and PDF