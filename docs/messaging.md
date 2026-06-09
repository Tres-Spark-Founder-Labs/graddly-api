# Direct messaging (MSG-001)

Backend support for PRD **F3.4.2 Direct Messaging**: separate tutor and line-manager threads per enrolment, plain-text messages with emoji, file attachments (max **10 MB**), unread counts, debounced email notifications, and archive-on-completion.

## Participant setup

Messaging requires tripartite platform user IDs on the enrolment:

| Field | Description |
|---|---|
| `apprenticeUserId` | Apprentice portal user |
| `tutorUserId` | Assigned tutor |
| `employerManagerUserId` | Employer line manager |

Set via `PATCH /api/v1/enrolments/:id/participants` or auto-synced from a fully signed commitment statement (only fills unset fields).

When all three IDs are present on an active enrolment, listing threads with `?enrolmentId=` provisions two threads:

- `tutor` — apprentice ↔ tutor
- `employer_manager` — apprentice ↔ line manager

## Endpoints

### Message threads (`MessageThreadsController`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/messaging/threads/unread-count` | Nav badge total unread |
| GET | `/api/v1/messaging/threads?enrolmentId=&apprenticeId=` | List threads (auto-provision when `enrolmentId` set) |
| GET | `/api/v1/messaging/threads/:id` | Thread detail + unread |
| PATCH | `/api/v1/messaging/threads/:id/read` | Mark thread read for current user |

### Messages (`MessagesController`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/messaging/threads/:threadId/messages` | Paginated history |
| POST | `/api/v1/messaging/threads/:threadId/messages` | Send message (403 if archived) |

Request body:

```json
{
  "body": "Hello 👋",
  "attachments": [
    {
      "storageKey": "orgs/.../learners/.../attachment/.../file.pdf",
      "filename": "file.pdf",
      "contentType": "application/pdf",
      "contentLength": 1024
    }
  ]
}
```

### Attachments (`MessageAttachmentsController`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/messaging/attachments/upload-url` | Presigned S3 upload (max 10 MB) |

Attachment flow:

1. `POST .../attachments/upload-url` with `apprenticeId`, `enrolmentId`, `filename`, `contentType`, `contentLength`
2. `PUT` file to returned `uploadUrl`
3. Include `storageKey` (and metadata) in `POST .../messages`

Keys must match `orgs/{orgId}/learners/{apprenticeId}/attachment/`.

## Notifications

- **In-app:** immediate `NotificationType.MESSAGE` to the other participant
- **Email:** debounced **5 minutes** via BullMQ (`message-received` template); respects per-user email preference for `message` type

## Access control

- **Participants** (snapshotted `apprenticeUserId` / `counterpartyUserId`) can read and write (unless archived)
- **Org `owner` / `admin`** can read all threads (safeguarding; not E2E encrypted per PRD)
- Messages are **not** accepted on archived threads (enrolment completed)

## Archive on completion

`POST /api/v1/enrolments/:id/complete` sets `archivedAt` on all threads for that enrolment. History remains readable.

## Related code

- Module: [`src/messaging/`](../src/messaging/)
- Migrations: `1780600000000`–`1780600000002`
- E2e: [`test/messaging/`](../test/messaging/)
