> Source: Gradlly PRD v1.0 (March 2026). Archived docx: [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx)

2. Platform Overview

## 2.1 Product Description

- Gradlly is the UK's first four-portal apprenticeship management platform.

- It connects employers, training providers, apprentices, and SMEs on a shared data layer — enabling real-time visibility, compliance automation, and funded AI skills training delivery across the entire apprenticeship lifecycle.

## 2.2 Portal Summary

## Portal

## Primary User

## Core Purpose

**Phase:** Phase 1 Priority

Portal 1 — Employer Portal

HR & L&D Managers at levy-paying employers

Levy management, apprentice tracking, commitment statements, ROI reporting

## MVP

Portal 2 — Provider Portal

Programme Managers, Tutors, Compliance Officers

Ofsted readiness, learner cohort management, ILR submission, employer engagement

## MVP

Portal 3 — Apprentice Portal

Active apprentices (aged 16–65, any standard)

OTJ logging, milestone tracking, KSB portfolio, communications

## MVP

Portal 4 — FlowPortal

SME employers, levy donors, AI programme learners

Levy Exchange marketplace, SME compliance dashboard, AI apprenticeship programme delivery

MVP (Levy Exchange Phase 2)

## 2.3 Shared Platform Components

The following components are shared across all four portals and must be built once as platform-level services, not duplicated per portal.

## Component

## Description

## Portals Consuming

## Authentication Service

OAuth 2.0 SSO with GOV.UK One Login and email/password fallback. JWT tokens, refresh token rotation, session management.

## All four

## Notification Engine

Email (transactional + digest), in-app push, and SMS notifications. Event-driven via internal message queue.

## All four

## File Storage Service

Secure document and evidence storage. AES-256 at rest. Files namespaced by organisation, learner, and type.

P1, P2, P3

## Audit Trail Service

Immutable log of all data mutations with user ID, timestamp, and before/after values. Exportable as CSV/PDF.

## All four

E-Signature Service

Legally binding e-signature workflow with biometric fallback. Stores signed PDFs with timestamp and IP metadata.

P1, P2, P3

## ESFA DAS API Client

OAuth 2.0 authenticated two-way sync with the ESFA Digital Apprenticeship Service API. Handles levy, enrolments, withdrawals, completions.

P1, P2, P4

Multi-Tenant Data Layer

Row-level security enforced at database level. Tenant isolation: employer A cannot access employer B data under any circumstances.

## All four

## User & Role Management

Configurable roles per portal. Invitation workflow, role assignment, deactivation. Separate user base per portal with cross-portal linking for tripartite workflows.

## All four

## 2.4 Cross-Portal Data Flows

The following data flows connect portals and must be supported by the shared platform layer:

Learner enrolment: Employer (P1) initiates → Provider (P2) accepts and creates ILR → Apprentice (P3) account created automatically

OTJ approval: Apprentice (P3) submits log → Employer (P1) receives notification and approves/rejects → P3 updates in real time

Commitment statement: Provider (P2) creates → Employer (P1) e-signs → Apprentice (P3) e-signs → PDF stored across all three portals

12-weekly review: Provider (P2) schedules and records → Employer (P1) notified and co-signs outcomes → Apprentice (P3) sees review history

Levy transfer: Employer (P1) or FlowPortal (P4) donor initiates transfer → SME on FlowPortal (P4) receives match → Enrolment creates learner on P3

At-risk flagging: System detects OTJ or review threshold breach → Provider (P2) intervention queue updates → Employer (P1) notified