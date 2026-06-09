# Gradlly Product Requirements (PRD)

> **Canonical dev reference:** markdown files in this folder.  
> **Source archive:** [Gradlly-PRD-v1.0.docx](./archive/Gradlly-PRD-v1.0.docx) (March 2026).

## Index

| File | Contents |
|------|----------|
| [00-overview.md](./00-overview.md) | Document purpose, audience, priority definitions |
| [01-platform.md](./01-platform.md) | Shared platform components, cross-portal flows |
| [02-employer-portal.md](./02-employer-portal.md) | Portal 1 — Employer (F1.x.x) |
| [04-provider-portal.md](./04-provider-portal.md) | Portal 2 — Provider (F2.x.x), Ofsted/EIF/QIP |
| [03-apprentice-portal.md](./03-apprentice-portal.md) | Portal 3 — Apprentice (F3.x.x) |
| [05-flowportal.md](./05-flowportal.md) | Portal 4 — FlowPortal |
| [06-non-functional.md](./06-non-functional.md) | NFRs (performance, security, accessibility) |
| [07-integrations.md](./07-integrations.md) | ESFA DAS, ILR, GOV.UK One Login |
| [08-data-model.md](./08-data-model.md) | Core entities and relationships |
| [09-release-phases.md](./09-release-phases.md) | MVP vs Phase 2 scope |

## Updating

1. Edit the markdown files directly for dev-facing requirement changes.
2. When product publishes a new Word PRD, replace the archive docx and re-run the port script or merge manually.
3. Reference feature IDs in code and docs (e.g. `F2.1.1` for EIF readiness scores).
