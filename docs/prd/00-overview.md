> Source: Gradlly PRD v1.0 (March 2026). Archived docx: [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx)

1. Document Purpose & Scope

- This Product Requirements Document (PRD) defines the complete functional and non-functional requirements for the Gradlly platform across all four portals.

- It is the primary reference document for the development team, product managers, QA engineers, and external technology partners.

- Each portal is specified independently with its own user context, feature set, acceptance criteria, and interface requirements.

- Cross-portal dependencies and shared platform requirements are specified in Sections 2 and 7.

## 1.1 Document Structure

Section 2 — Platform Overview: architecture, shared systems, and cross-portal dependencies

Section 3 — Portal 1 (Employer Portal): full feature requirements and acceptance criteria

Section 4 — Portal 2 (Provider Portal): full feature requirements and acceptance criteria

Section 5 — Portal 3 (Apprentice Portal): full feature requirements and acceptance criteria

Section 6 — Portal 4 (FlowPortal): full feature requirements and acceptance criteria

Section 7 — Non-Functional Requirements: performance, security, accessibility, availability

Section 8 — Integration Requirements: ESFA DAS API, ILR, GOV.UK One Login

Section 9 — Data Model: key entities and relationships across all four portals

Section 10 — Release Phases: MVP scope, Phase 2 features, and future roadmap items

## 1.2 Intended Audience

## Role

## Sections of Primary Relevance

## Engineering Lead / CTO

All sections — architecture authority

## Frontend Engineers

Sections 3–6 (feature requirements per portal), Section 7 (NFRs)

## Backend Engineers

Sections 2, 7, 8, 9 — platform, integrations, data model

## QA Engineers

Sections 3–6 acceptance criteria, Section 7 performance & accessibility

## Product Managers

All sections — requirement ownership and prioritisation

## Design Lead

Sections 3–6 interface requirements, Section 7.3 accessibility

## Compliance Officer

Section 8 ESFA/ILR integrations, Section 7.2 security

## 1.3 Requirement Priority Definitions

## Priority

## Definition

## Phase

## Must Have

Platform cannot launch without this requirement met. MVP-blocking.

**Phase:** Phase 1 (MVP)

## Should Have

High-value feature required within 90 days of launch. Not MVP-blocking.

**Phase:** Phase 1 post-launch

## Could Have

Valuable enhancement for Phase 2 (Months 7–18). Improves product quality.

**Phase:** Phase 2

**Priority:** Won't Have (Now)

Explicitly out of scope for Phases 1 and 2. Acknowledged for future consideration.

**Phase:** Phase 3+