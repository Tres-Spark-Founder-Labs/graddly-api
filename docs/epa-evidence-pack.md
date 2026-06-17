# EPA evidence pack (PRD-007)

Apprentice-scoped async export of programme artefacts for EPAO submission (F3.3.4).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/portfolio/epa-pack-jobs` | Queue ZIP build for an enrolment |
| `GET` | `/api/v1/portfolio/epa-pack-jobs/:id` | Poll job status; presigned download when complete |

## Access

Caller must be in the active organisation and able to access the enrolment:

- Linked apprentice (`enrolment.apprenticeUserId`)
- Enrolment tutor or employer manager
- Organisation owner or admin

## Job lifecycle

1. `POST` with `{ "enrolmentId": "<uuid>" }` → `201` with `jobId`, `status: queued`
2. BullMQ worker (`epa-pack` queue) gathers artefacts and uploads ZIP to object storage
3. Poll `GET` until `status` is `completed` or `failed`
4. On `completed`, response includes `downloadUrl` and `downloadExpiresAt` (presigned S3 URL)

## ZIP layout

| Path | Contents |
|------|----------|
| `knowledge/`, `skill/`, `behaviour/` | Accepted evidence files and reflective statements, mapped by KSB kind |
| `ksb-summary.json` | KSB heatmap (coverage strength per definition) |
| `reviews/` | Completed review JSON + signed PDFs when available |
| `otj-summary.json` | Approved OTJ minutes and pace snapshot |
| `commitment/` | Signed commitment statement PDF |

`manifest` on the job response counts files per section.

## Related

- Provider Ofsted pack: `docs/` + `POST /ofsted/evidence-packs` (org-wide EIF ZIP)
- Portfolio evidence: [portfolio.md](./portfolio.md)
