# Learner document library (PRD-020)

Unified document list for the authenticated apprentice user (F3.4.3 document library aggregate).

## Endpoint

`GET /api/v1/learners/me/documents`

### Query parameters

| Param | Required | Description |
|-------|----------|-------------|
| `enrolmentId` | No | Filter to one enrolment linked to the caller |

### Access

Only enrolments where `enrolment.apprenticeUserId` matches the JWT user are included. Filtering by `enrolmentId` returns `403` when that enrolment is not linked to the caller.

## Response

```json
{
  "enrolments": [
    {
      "enrolmentId": "<uuid>",
      "items": [
        {
          "id": "<uuid>",
          "type": "commitment | review | evidence",
          "title": "...",
          "documentAt": "2026-01-01T00:00:00.000Z",
          "storageKey": "orgs/.../file.pdf",
          "externalUrl": null,
          "downloadUrl": "https://...",
          "downloadExpiresAt": "2026-01-01T00:05:00.000Z"
        }
      ]
    }
  ]
}
```

Items are sorted reverse-chronologically within each enrolment group.

## Sources

| Type | Source | Download |
|------|--------|----------|
| `commitment` | Signed current commitment statement (`finalSignedPdfKey`) | Presigned URL |
| `review` | Completed reviews (`finalSignedPdfKey` or snapshot PDF job) | Presigned URL when stored |
| `evidence` | Accepted portfolio evidence | Presigned URL for files; `externalUrl` for links |

Presigned URL TTL is configured via `S3_PRESIGN_DOWNLOAD_TTL_SECONDS`.

## Related

- EPA pack export: [epa-evidence-pack.md](./epa-evidence-pack.md)
- File storage: [file-storage.md](./file-storage.md)
