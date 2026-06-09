> Source: Gradlly PRD v1.0 (March 2026). Archived docx: [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx)

7. Non-Functional Requirements

The following requirements apply across all four portals unless a specific portal exception is noted.

## 7.1 Performance Requirements

## Requirement

## Target

## Measurement Method

## Applies To

Page load time (standard pages)

< 2 seconds on 4G mobile

Lighthouse performance score ≥ 80 in CI pipeline

## All portals

Page load time (data-heavy pages)

< 3 seconds on 4G mobile

Measured on cohort table with 500 rows

P1, P2

API response time (read)

< 500ms at p95

APM monitoring — alert on breach

## All portals

API response time (write)

< 800ms at p95

APM monitoring — alert on breach

## All portals

## DAS API sync cycle

< 5 minutes for 500 learner records

## Background job monitoring

P1, P2, P4

## PDF report generation

< 10 seconds

Measured at trigger to download-ready

P1, P2

## EPA evidence pack export

< 60 seconds

Measured at trigger to ZIP download-ready

P2, P3

OTJ log submission (mobile)

< 30 seconds end to end

## Measured from form open to confirmation screen

P3

## FlowPortal matching results

< 3 seconds

## Measured from profile completion to results displayed

P4

## Concurrent users per portal

≥ 500 without performance degradation

Load test at launch, re-run quarterly

## All portals

## 7.2 Security Requirements

## Requirement

## Specification

## Applies To

## Authentication

OAuth 2.0 with GOV.UK One Login primary; email/password with bcrypt hashing as fallback; MFA required for provider and employer admin accounts

## All portals

## Session management

JWT access tokens (15-minute expiry); refresh token rotation; forced re-authentication after 8 hours of inactivity

## All portals

## Data encryption at rest

AES-256 encryption for all PII and financial data at database level

## All portals

## Data encryption in transit

TLS 1.3 minimum for all client-server communication; HSTS enforced

## All portals

Multi-tenant isolation

Row-level security enforced at database level; employer A data inaccessible to employer B under all circumstances

## All portals

## API security

All API endpoints require valid JWT; rate limiting: 100 requests per minute per user; OWASP Top 10 compliance

## All portals

## GDPR compliance

Data retention policies enforced; right-to-erasure workflow; DPA template provided to all customers; ICO registration maintained

## All portals

## Penetration testing

External pen test by CREST-accredited firm before production launch; annual re-test

## All portals

## Cyber Essentials Plus

## Certification achieved before production launch

Platform-wide

ISO 27001

Roadmap in place from day one; certification targeted within 18 months of launch

Platform-wide

## Vulnerability disclosure

Public responsible disclosure policy published; bug bounty programme in Phase 2

Platform-wide

## Audit logging

All data mutations logged with user, timestamp, before/after values; logs immutable; retained for 7 years

## All portals

## 7.3 Accessibility Requirements

## Requirement

## Standard

## Testing Method

## WCAG compliance level

WCAG 2.1 AA across all four portals

Automated (axe-core in CI) + manual audit per release

Colour contrast — body text

Minimum 4.5:1 contrast ratio

## All four portal colour schemes tested against the standard

Colour contrast — large text

Minimum 3:1 contrast ratio

## Applied to all heading and display text

## Screen reader compatibility

NVDA (Windows) and VoiceOver (macOS/iOS) — all core user journeys must be completable

## Manual testing on each portal before release

## Keyboard navigation

All interactive elements reachable and operable by keyboard alone; visible focus states required

Manual keyboard-only testing on core journeys

## Focus management

Focus is moved appropriately on modal open/close, page navigation, and form submission

Automated + manual testing

## Touch target size

Minimum 44×44px for all interactive elements on mobile (Portal 3 and P4 mobile)

## Mobile Lighthouse audit

## Form accessibility

All form inputs have associated labels; error messages are descriptive and announced by screen readers

axe-core automated testing

## Images and icons

All informational images have alt text; decorative images have empty alt text; icon-only buttons have aria-label

## Manual audit per release

Portal 3 specific

All OTJ logging journeys must achieve WCAG 2.1 AA with no manual workaround steps

## Quarterly dedicated accessibility audit

## 7.4 Availability & Reliability Requirements

## Requirement

## Target

## Notes

## Production uptime SLA

99.9% (< 8.7 hours downtime per year)

Measured on a rolling 30-day window

## Maintenance windows

02:00–04:00 GMT only; 48-hour advance notice to customers

## Maintenance page served during downtime

Recovery Point Objective (RPO)

# 1 hour maximum data loss in disaster scenario

Database snapshots every 30 minutes

Recovery Time Objective (RTO)

# 4 hours maximum to restore service after disaster

Tested in DR exercise every 6 months

## Database backups

Full daily backup; incremental every 30 minutes; retained for 90 days

## Backups stored in geographically separate region

## Error monitoring

Automated alerting on error rate > 1% per endpoint; PagerDuty escalation to on-call engineer

## Sentry or equivalent

## Status page

Public status page (statuspage.io or equivalent) showing real-time platform health per portal

## Customers subscribe to status alerts

## 7.5 Browser & Device Support

## Platform

## Browsers / OS Supported

## Portal Priority

Desktop — Windows

Chrome (latest 2 versions), Edge (latest 2 versions), Firefox (latest 2 versions)

P1, P2 primary; P3, P4 supported

Desktop — macOS

Chrome (latest 2 versions), Safari (latest 2 versions)

P1, P2 primary; P3, P4 supported

Mobile — iOS

Safari on iOS 15+; Chrome on iOS 15+

P3 and P4 primary; P1, P2 supported

Mobile — Android

Chrome on Android 10+

P3 and P4 primary; P1, P2 supported

Tablet — iPad

Safari on iPadOS 15+

All portals — responsive layout required

## Not supported

Internet Explorer (all versions); browsers more than 2 major versions behind current

## Graceful degradation page shown