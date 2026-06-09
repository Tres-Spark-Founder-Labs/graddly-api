> Source: Gradlly PRD v1.0 (March 2026). Archived docx: [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx)

9. Data Model — Key Entities

- The following defines the core entities and their relationships across the Gradlly platform.

- This is a conceptual data model intended to guide database schema design — not a physical schema specification.

## 9.1 Core Entities

## Entity

## Description

## Key Attributes

Portal(s)

## Organisation

Any legal entity using Gradlly — employer, provider, or SME

ID, name, UKPRN (providers), Companies House number, DAS account ID, organisation type, subscription tier

## All

## User

## Any individual with a Gradlly account

ID, email, name, organisation ID, portal access rights, role, MFA status, One Login ID

## All

## Apprentice

## A learner enrolled on an apprenticeship programme

User ID, employer org ID, provider org ID, standard code, start date, expected end date, EPA organisation, current status

P1, P2, P3, P4

## Programme

## An apprenticeship standard offered on the platform

ID, standard code, standard name, level, typical duration, EPA methods, delivery type (employer-led / FlowPortal AI)

P1, P2, P4

## OTJ Log Entry

A single off-the-job learning session logged by an apprentice

ID, apprentice ID, date, activity name, category, hours, evidence files, submission timestamp, approval status, approver user ID, approval timestamp

P1, P3

## Review

A 12-weekly progress review between tutor, learner, and employer

ID, apprentice ID, tutor user ID, employer user ID, scheduled date, completed date, goals, action points, wellbeing rating, sign-off status, signed PDF URL

P2, P3

## Commitment Statement

The tripartite agreement between employer, provider, and apprentice

ID, apprentice ID, version number, created by user ID, content text, employer signature, provider signature, apprentice signature, signed PDF URL, status

P1, P2, P3

## KSB Evidence Item

## A piece of portfolio evidence mapped to one or more KSBs

ID, apprentice ID, file URL or link, evidence type, KSB IDs mapped, reflective statement, tutor feedback, status, created at

P2, P3

## Levy Transfer

## A transfer of levy funds from a donor organisation to an SME

ID, donor org ID, recipient org ID, amount, ESFA transfer reference, status, created at, confirmed at, expiry date

P1, P4

## Notification

A system-generated alert sent to a user

ID, user ID, type, content, read status, created at, delivery channel, delivery status

## All

## Audit Log Entry

## An immutable record of a data mutation event

ID, user ID, entity type, entity ID, action, before value (JSON), after value (JSON), timestamp, IP address

## All

## 9.2 Key Relationships

One Organisation can have many Users, many Apprentices (as employer), and many Programmes (as provider)

One Apprentice has exactly one employer Organisation and exactly one provider Organisation at any point in time

One Apprentice has many OTJ Log Entries, many Reviews, one active Commitment Statement, and many KSB Evidence Items

One Commitment Statement belongs to exactly one Apprentice and has three signatories (employer User, provider User, apprentice User)

One Levy Transfer links exactly one donor Organisation to exactly one recipient Organisation and may fund one or many Apprentices

All entities that involve PII are linked to the Organisation record for multi-tenant isolation — queries filtered by organisation ID at the data layer