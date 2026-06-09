> Source: Gradlly PRD v1.0 (March 2026). Archived docx: [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx)

## PORTAL 3  ·  PRODUCT REQUIREMENTS

## Apprentice Portal

Log it. Track it. Own your journey.

5. Portal 3 — Apprentice Portal

## 5.1 Portal Context

## Portal ID

P3

## Target users

Active UK apprentices, aged 16–65, any standard, any sector

## Primary goal

Give every apprentice a friction-free, mobile-first tool to log OTJ hours, track their journey, build their portfolio, and stay connected to their employer and tutor

## Design tone

Warm, human, encouraging. Progress is celebrated. Next actions are always clear. Should never feel like a compliance tool.

## Primary colour

#0F7A53 (Forest Green) — Plus Jakarta Sans

## Critical constraint

Every core action must be completable in under 30 seconds on a mobile device with a 4G connection

## Access device

Mobile-first (iOS and Android web app, native app Phase 2); desktop fully supported

## 5.2 Feature Requirements

5.2.1 OTJ Tracker

### F3.1.1 F3.1.1

## Quick OTJ Log Entry

## Must Have

**Phase:** Phase 1

## Description

Apprentices must be able to log an OTJ session in under 30 seconds on a mobile device. The form must be minimal, intuitive, and accessible.

**Acceptance criteria**

Log form contains exactly four fields: activity name (free text, max 80 chars), category (dropdown), duration (hours stepper in 0.5 increments), evidence (optional file/photo/link)

Category dropdown options: Taught learning / Applied project / Mentoring & coaching / Job shadowing / Off-site learning / Other

Form submits with a single tap — no multi-step flow

Successful submission shows a green confirmation state with updated running total

Entire form-to-submission flow must complete in under 30 seconds on a 4G connection

## Form is accessible via a persistent floating action button on all app screens

### F3.1.2 F3.1.2

## OTJ Progress Visualisation

## Must Have

**Phase:** Phase 1

## Description

The apprentice must have a clear, motivating visual representation of their OTJ progress toward the statutory 20% target.

**Acceptance criteria**

Circular progress ring on the home screen shows: hours logged, hours required, and percentage complete

Ring colour: green (>70% of target), amber (50–70%), red (<50%)

## Horizontal progress bar also shown below the ring with exact hour counts

Weekly bar chart shows hours logged per week for the last 8 weeks

## Projected completion date shown based on current logging pace

### F3.1.3 F3.1.3

## OTJ Session History

## Must Have

**Phase:** Phase 1

## Description

Apprentices must be able to view all their logged OTJ sessions with approval status.

**Acceptance criteria**

Session list shows: date, activity name, category, hours, evidence indicator, approval status badge

Status badges: Pending (amber) / Approved (green) / Flagged (red)

Tapping a session shows the full entry including any rejection reason from the line manager

## Apprentice can edit and resubmit a flagged entry

## List is searchable by activity name and filterable by status and date range

### F3.1.4 F3.1.4

## Smart Pace Alerts

## Must Have

**Phase:** Phase 1

## Description

The system must proactively alert apprentices when they are falling behind the required OTJ pace to meet their 20% target by their EPA date.

**Acceptance criteria**

## Required weekly OTJ hours are calculated and displayed on the home screen

Amber in-app alert appears when the apprentice is more than 15% behind required pace

Red alert appears when more than 30% behind

Push notification sent if the apprentice has not logged any OTJ in the last 7 days

## Alerts include a CTA to log hours immediately

## Alerts are dismissible but recur each week until pace is restored

5.2.2 Journey Milestones

### F3.2.1 F3.2.1

## Programme Timeline

## Must Have

**Phase:** Phase 1

## Description

Apprentices must have a clear visual timeline of their entire programme from enrolment to EPA, showing completion status at every stage.

**Acceptance criteria**

Timeline displays all programme milestones in chronological order: enrolment, induction, 12-weekly reviews, gateway, EPA, completion

Each milestone is marked as: complete (green tick) / current (blue highlight) / upcoming (grey)

Tapping a milestone shows its details: date, description, any associated documents, and sign-off status

Timeline scrolls vertically on mobile and fits a single screen on desktop (12-inch+)

### F3.2.2 F3.2.2

## Gateway Readiness Checklist

## Must Have

**Phase:** Phase 1

## Description

The gateway readiness checklist must show the apprentice exactly what is required before they can be nominated for End Point Assessment.

**Acceptance criteria**

## Checklist displays all gateway criteria defined by the apprenticeship standard

Each criterion is marked: complete / in progress / not started

## Criteria that are blocked by an upstream dependency show the blocker clearly

## Checklist completion percentage is displayed as a progress bar

When all criteria are complete, a "Gateway Ready" badge is displayed and the provider is notified

### F3.2.3 F3.2.3

## EPA Countdown

## Must Have

**Phase:** Phase 1

## Description

Apprentices must see a prominent countdown to their EPA date on the home screen.

**Acceptance criteria**

## EPA countdown displays days remaining as a large number on the home screen

Countdown changes colour: green (>90 days) / amber (30–90 days) / red (<30 days)

If EPA date has not been set by the provider, a placeholder message is shown: "EPA date not yet confirmed — speak to your tutor"

## Tapping the countdown opens the gateway readiness checklist

### F3.2.4 F3.2.4

## Review History

## Must Have

**Phase:** Phase 1

## Description

Apprentices must be able to view all their 12-weekly progress reviews, including outcomes, action points, and signed records.

**Acceptance criteria**

## Review list shows all completed reviews in reverse chronological order

Each review entry shows: date, tutor name, goals set, goals achieved, action points, and sign-off status

## Apprentice can view and download the full signed review record as PDF

## Upcoming review date is shown on the home screen

Apprentice receives a reminder 48 hours before each scheduled review

5.2.3 KSB Portfolio

### F3.3.1 F3.3.1

## Evidence Library

## Must Have

**Phase:** Phase 1

## Description

Apprentices must be able to upload and manage evidence items mapped to specific KSBs (Knowledge, Skills, and Behaviours) required by their apprenticeship standard.

**Acceptance criteria**

Evidence items can be: file upload (PDF, DOCX, PPTX, XLSX, images, max 25MB per file), link to external resource, or text entry

Each evidence item must be mapped to one or more KSBs from the apprentice's standard

## Evidence items can be tagged with multiple KSBs

## Evidence library is searchable by KSB and filterable by evidence type

Each item has a status: draft / submitted / reviewed by tutor / accepted

### F3.3.2 F3.3.2

## KSB Coverage Heatmap

## Must Have

**Phase:** Phase 1

## Description

A visual heatmap must show the apprentice and their tutor the strength of evidence coverage across all required KSBs.

**Acceptance criteria**

Heatmap displays all KSBs in a grid — one cell per KSB

Cell colour indicates coverage strength: green (strong — 3+ accepted evidence items) / blue (good — 2 items) / amber (partial — 1 item) / red (weak — drafted only) / grey (missing — no evidence)

## Tapping a cell shows the evidence items mapped to that KSB

## Heatmap is visible to both the apprentice and their tutor

Tutor can mark KSBs as "sufficient" or "requires more evidence" from the heatmap view

### F3.3.3 F3.3.3

## Reflective Statement Tool

## Should Have

**Phase:** Phase 1 post-launch

## Description

Apprentices must have a guided writing tool for producing reflective statements attached to evidence items.

**Acceptance criteria**

Reflective statement editor provides structured prompts: Situation / Task / Action / Result (STAR framework)

Auto-save every 30 seconds — no data loss on browser close

Word count indicator shown against recommended range (200–400 words)

## Tutor can add inline comments on the statement

## Completed statements are included in the EPA evidence pack export

### F3.3.4 F3.3.4

## EPA Evidence Pack Export

## Must Have

**Phase:** Phase 1

## Description

Apprentices must be able to export a complete, formatted EPA evidence pack with a single tap, ready for submission to their EPAO.

**Acceptance criteria**

Export compiles: all accepted evidence items, reflective statements, KSB coverage summary, review history, OTJ summary, and commitment statement

## Pack is structured by KSB category and formatted as a single PDF

Export is generated within 60 seconds

## Apprentice can preview the pack before generating the final export

## Download link is also sent by email for convenience

5.2.4 Communications & Documents

### F3.4.1 F3.4.1

## Commitment Statement Signing

## Must Have

**Phase:** Phase 1

## Description

Apprentices must be able to review and e-sign their commitment statement within the app, with the content presented in plain English — not legal language.

**Acceptance criteria**

Plain-English commitment statement summary is shown before the full document

Full document is accessible via "View full statement" toggle

E-signature is captured via drawn signature on mobile or typed name on desktop

Apprentice must tick a "I confirm I have read and understood my commitment" checkbox before signing

## Signed PDF is immediately available in the document library

If the apprentice has not signed within 7 days of the employer signing, an automated reminder is sent

### F3.4.2 F3.4.2

## Direct Messaging

## Must Have

**Phase:** Phase 1

## Description

Apprentices must be able to send direct messages to their assigned tutor and line manager within the portal.

**Acceptance criteria**

## Separate message threads for tutor and line manager

Messages support: plain text, file attachments (max 10MB), and emoji

## Unread message count is shown as a badge on the messaging nav item

Tutor and manager receive email notification of new messages within 5 minutes

Message history is retained for the lifetime of the programme and archived on completion

Messages are not end-to-end encrypted — provider and employer admin can view all threads for safeguarding purposes (disclosed in privacy notice)

### F3.4.3 F3.4.3

## Notification Centre

## Must Have

**Phase:** Phase 1

## Description

All platform notifications must be aggregated in a single notification centre, with the ability to manage notification preferences.

**Acceptance criteria**

Notification centre lists all notifications in reverse chronological order with: type icon, description, timestamp, and read/unread state

Notification types: OTJ approval, review reminder, message received, commitment statement action required, EPA date update, milestone completed

Apprentice can configure per-type email notification preferences (on / off)

Push notification support for native mobile app (Phase 2) — web push in MVP

## Unread count badge shown on notification bell icon in top nav