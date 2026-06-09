> Source: Gradlly PRD v1.0 (March 2026). Archived docx: [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx)

## PORTAL 4  ·  PRODUCT REQUIREMENTS

## FlowPortal

Levy flows. Talent flows. Growth flows.

6. Portal 4 — FlowPortal

## 6.1 Portal Context

## Portal ID

P4

## Target users

SME owners / managers (5–249 employees), levy donor L&D leads at large employers, AI apprenticeship learners from SMEs

## Primary goal

- Route unclaimed Apprenticeship Levy capital from large employers to SMEs, enable funded AI skills apprenticeship enrolment, and give SMEs a fully managed compliance dashboard with no HR function required

## Design tone

Dynamic, growth-oriented, accessible. Should feel like a modern marketplace and learning platform: energetic, clear, confidence-building

## Primary colour

#0E7490 (Teal) — DM Sans

## Three modules

Module A — Levy Exchange marketplace | Module B — SME Employer Dashboard | Module C — AI Apprenticeship Programmes

## Access device

Desktop and mobile equally important — many SME owners will access via phone

## 6.2 Module A — Levy Exchange

- The Levy Exchange is a two-sided marketplace that automates every step of the ESFA levy transfer process — from DAS account linking to compliance documentation — cutting transfer time from weeks to 48 hours.

6.2.1 Donor-Side Features

### F4.1.1 F4.1.1

## Donor DAS Account Linking

## Must Have

**Phase:** Phase 1

## Description

Levy donor organisations must be able to link their ESFA Digital Apprenticeship Service account to FlowPortal to enable automated transfer processing.

**Acceptance criteria**

DAS account linking is completed via ESFA OAuth 2.0 consent flow — no credentials stored

Linking process is completable in under 48 hours end to end

Linked account shows: total levy balance, available transfer amount (up to 50%), expiry schedule

Donor can link multiple DAS accounts (e.g. for different legal entities within the same group)

Linking status is shown as: linked / pending consent / error with resolution guidance

### F4.1.2 F4.1.2

## Surplus Levy Calculator & Expiry Alerts

## Must Have

**Phase:** Phase 1

## Description

Donors must be able to see their exact transferable surplus and receive automated alerts when funds are approaching the 24-month expiry window.

**Acceptance criteria**

Surplus calculator displays: total levy balance, amount already committed to own apprenticeships, maximum transferable amount (up to 50% of annual contribution), amount already transferred

Expiry calendar shows which tranches of levy expire in each of the next 24 months

Automated email alert sent when any tranche will expire within 90 days

Second alert sent at 30 days before expiry

## Alert includes a direct CTA to initiate a transfer

### F4.1.3 F4.1.3

## Transfer Preference Settings

## Should Have

**Phase:** Phase 1 post-launch

## Description

Donors must be able to set preferences that guide the matching algorithm to surface the most appropriate SME recipients for their transfer.

**Acceptance criteria**

Preferences include: preferred sector(s), preferred region(s), preferred SME size band, preferred programme type

## Donor can set a maximum transfer amount per SME recipient

Preferences are saved and applied to all future matching suggestions until changed

Donor can also choose "open matching" — no preferences, widest possible recipient pool

### F4.1.4 F4.1.4

## Donor Analytics Portal

## Could Have

**Phase:** Phase 2

## Description

Donors must be able to view the outcomes of their levy transfers to support ESG reporting and social value commitments.

**Acceptance criteria**

Analytics dashboard shows: total amount transferred to date, number of SMEs funded, number of learners enrolled, programme completion rate, EPA pass rate

Breakdown by sector, region, and programme type

ESG impact summary card: estimated productivity uplift, social mobility score (Sutton Trust methodology)

## Report is exportable as PDF for inclusion in annual ESG or social value reports

6.2.2 SME-Side Features

### F4.2.1 F4.2.1

## Levy Eligibility Checker

## Must Have

**Phase:** Phase 1

## Description

SME employers must be able to instantly check whether they are eligible to receive a levy transfer and how much funding is available in their sector and region.

**Acceptance criteria**

Eligibility checker requires: company size (employee count), sector, region, and whether they have an existing ESFA DAS account

Result shows: eligibility status (eligible / not eligible / check with advisor), estimated available funding, and next steps

Checker does not require account creation — accessible to anonymous visitors

If eligible, a CTA prompts the SME to begin ESFA registration wizard (F4.2.2)

### F4.2.2 F4.2.2

## ESFA Registration Wizard

## Must Have

**Phase:** Phase 1

## Description

SMEs must be able to complete ESFA DAS account creation and levy transfer consent through a guided wizard that requires no prior knowledge of the apprenticeship system.

**Acceptance criteria**

Wizard is structured in 5 steps: company verification (Companies House lookup) / PAYE reference entry / DAS account creation / bank details / consent to receive transfers

Each step includes contextual help text explaining why the information is needed

Progress is saved at each step — SME can leave and return without losing progress

## Wizard completion sends a confirmation email with next steps

End-to-end completion time target: under 20 minutes

SME Success Manager is offered as an optional support resource at step 3 for first 100 SMEs

### F4.2.3 F4.2.3

Donor-SME Matching

## Must Have

**Phase:** Phase 1

## Description

The platform must match eligible SMEs with suitable levy donors using a combination of rule-based matching criteria (Phase 1) and ML-based optimisation (Phase 2).

**Acceptance criteria**

**Phase:** Phase 1 matching criteria: sector alignment / regional proximity / programme type / transfer amount required vs available

Matching results are returned within 3 seconds of an SME completing their profile

Each match displays: donor organisation name (or "Matched donor" if anonymous), transfer amount available, programme eligibility, estimated timeline

SME submits a transfer application which is reviewed and confirmed by the donor or auto-approved if the donor has set open matching

## Both parties receive email confirmation of a confirmed match

If no match is found, SME is placed in a waiting pool and notified when a match becomes available

### F4.2.4 F4.2.4

## Transfer Compliance Documentation

## Must Have

**Phase:** Phase 1

## Description

All required ESFA compliance documentation for levy transfers must be auto-generated by the platform for both donor and recipient.

**Acceptance criteria**

Transfer agreement document is auto-generated and e-signed by both parties within the platform

Document includes: transfer amount, programme details, ESFA reference, dates, signatory details

Copies are stored in both the donor's and SME's FlowPortal document libraries

ESFA transfer record is created via API on confirmation — no manual ESFA portal entry required

## 6.3 Module B — SME Employer Dashboard

6.3.1 SME Compliance Dashboard

### F4.3.1 F4.3.1

## SME Apprentice Overview

## Must Have

**Phase:** Phase 1

## Description

SME employers must have a simple, time-efficient view of all their apprentices and any actions required from them — designed for employers with no HR function.

**Acceptance criteria**

Overview shows: active apprentice count, OTJ approvals pending, reviews due this month, funding claim status

Apprentice list shows: name, programme, OTJ %, next review date, status badge

All pending OTJ approvals are listed with a one-tap approve / flag action

## SME employer can access the overview from mobile with full functionality

Dashboard loads within 2 seconds on 4G mobile

### F4.3.2 F4.3.2

## Commitment Statement Management

## Must Have

**Phase:** Phase 1

## Description

SME employers must be able to view, sign, and manage commitment statements for all their FlowPortal apprentices.

**Acceptance criteria**

Commitment statements requiring SME signature are surfaced at the top of the dashboard

E-signature flow is the same as Portal 1 (F1.3.2) — consistent experience

## Signed copies are stored in the SME document library

Automated chase reminder sent to SME if statement unsigned after 7 days

### F4.3.3 F4.3.3

## ESFA Funding Claim Tracker

## Should Have

**Phase:** Phase 1 post-launch

## Description

SME employers must be able to see the status of their levy funding claims to maintain confidence in the financial arrangement.

**Acceptance criteria**

Funding tracker shows: total levy funding committed per programme, amount claimed to date, amount received, any discrepancies

Each line item links to the relevant ILR submission record in the provider portal (visible to SME summary only)

Alert shown if a funding discrepancy is identified — SME is directed to contact their provider

### F4.3.4 F4.3.4

## SME Onboarding Concierge

## Must Have

**Phase:** Phase 1

## Description

The first 100 SME employers must receive a managed onboarding experience with access to a dedicated SME Success Manager for the first 90 days.

**Acceptance criteria**

On account creation, SME is assigned a named Success Manager (Gradlly staff)

Concierge dashboard shows: onboarding checklist completion %, upcoming scheduled calls, and direct message thread with Success Manager

Automated milestone emails are sent at: registration, DAS linking, first learner enrolment, first OTJ approval, first review

Money-back guarantee is documented in the SME welcome pack and linked from the dashboard