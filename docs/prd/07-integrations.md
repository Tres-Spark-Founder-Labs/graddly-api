> Source: Gradlly PRD v1.0 (March 2026). Archived docx: [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx)

8. Integration Requirements

## 8.1 ESFA Digital Apprenticeship Service (DAS) API

## Integration Point

## Direction

## Data Exchanged

## Portals

## Frequency

## Levy balance sync

DAS → Gradlly

Available balance, monthly contributions, expiry dates, transaction history

P1, P4

Every 15 minutes + on-demand

## Enrolment submission

Gradlly → DAS

Learner details, standard code, provider UKPRN, start date, planned end date

P2, P4

Within 5 minutes of ILR creation

## Withdrawal notification

Gradlly → DAS

Learner ID, withdrawal date, reason code

P2

Within 5 minutes of withdrawal record

## Completion notification

Gradlly → DAS

Learner ID, completion date, EPA outcome

P2

Within 5 minutes of completion record

## Funding payment confirmation

DAS → Gradlly

Payment amounts, payment dates, funding period, any clawback notices

P2, P4

## Daily batch sync

## Levy transfer consent

Gradlly → DAS

Transfer amount, recipient account, start date

P1, P4

## On transfer confirmation

## Transfer status

DAS → Gradlly

Transfer status, amounts released, payment dates

P1, P4

## Daily batch sync

## DAS API Technical Requirements

Authentication via ESFA OAuth 2.0 — access tokens refreshed 5 minutes before expiry

All DAS API calls logged with request ID, timestamp, response code, and response time

Retry logic: exponential backoff with 3 retries on 5xx responses; dead letter queue for persistent failures

Manual sync trigger available in both Provider Portal (P2) and Employer Portal (P1) for admin use

DAS API unavailability must not block core platform functionality — degraded mode with last-known data displayed

## 8.2 ILR Submission (ESFA)

## Requirement

## Specification

## ILR version

Current ESFA ILR specification (updated annually — platform must support new spec within 30 days of ESFA publication)

## Data fields

All mandatory ILR fields auto-populated from Gradlly learner records; optional fields configurable by provider

## Validation

Full ESFA validation rules applied before submission; provider sees plain-English error descriptions for all validation failures

## Submission method

Direct API submission to ESFA ILR Submission API — no manual file upload to ESFA portal required

## Submission confirmation

ESFA submission receipt stored in provider portal with reference number and timestamp

## Amendment submission

Provider can submit ILR amendments via the same workflow for any period within ESFA's amendment window

## 8.3 GOV.UK One Login

## Requirement

## Specification

## Integration type

OpenID Connect (OIDC) with GOV.UK One Login as the identity provider

## Portals

All four portals — One Login available as an authentication option alongside email/password

## Fallback

If One Login is unavailable, email/password login must remain fully functional

## User linking

Existing Gradlly accounts can be linked to One Login via account settings — email address match required

## Scope

Core identity scope only: name, email, date of birth — no additional scopes requested beyond what is necessary

## 8.4 Notification & Communication Integrations

## Service

## Purpose

## Portals

## Notes

Transactional email (SendGrid or equivalent)

All system-generated emails: invitations, notifications, digests, reports

## All portals

SPF, DKIM, DMARC configured; bounce and complaint monitoring

SMS (Twilio or equivalent)

Critical alerts: EPA date changes, overdue OTJ warnings (Phase 2)

P3

Opt-in only; GDPR compliant

## Web push notifications

In-app and background notifications for Portal 3

P3

Service Worker implementation; user opt-in flow required

Video conferencing (Zoom / Microsoft Teams)

## AI programme cohort session delivery via FlowPortal

P4

API integration for auto-generating session links; attendance tracking

Cloud file storage (AWS S3 or equivalent)

Secure evidence, document, and media storage

P2, P3, P4

AES-256 at rest; presigned URLs for file access; 7-year retention