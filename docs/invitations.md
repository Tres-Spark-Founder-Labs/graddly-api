# Organisation invitations

Org-scoped invitation flow: owners and admins create invites; invitees accept with a JWT and an opaque Redis-backed token. Listing is paginated with a shared envelope (`data` + `meta`).

## Endpoints (global prefix `/api/v1`)

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| POST | `/invitations` | JWT + active org + owner/admin | Body: `email`, `role` (`owner` \| `admin` \| `member`), optional `expiresAt` (ISO 8601). Default expiry is 14 days. Optional `X-Portal-Type` header selects which frontend the invitation email links to. |
| GET | `/invitations` | JWT + active org | Query: `page` (default 1), `perPage` (default 20, max 100). Response: `{ message, data: Invitation[], meta: PaginationMeta }`. |
| POST | `/invitations/:id/resend` | JWT + active org + owner/admin | Refreshes Redis accept token and sends email again. |
| DELETE | `/invitations/:id` | JWT + active org + owner/admin | Soft-revokes the invite and clears Redis accept tokens for that invitation. |
| POST | `/invitations/accept` | JWT only (no active org) | Body: `token` (UUID v4). Requires verified email on the user matching the invite email. Uses **RLS bootstrap** so the row can be read/updated before membership exists. |

Optional header on org-scoped routes: `X-Organisation-Id` (same behaviour as other org APIs).

## Accept link (frontend)

Transactional email points to:

`{FRONTEND_BASE_URL}/accept-invitation?token=<uuid>`

(`FRONTEND_BASE_URL` is configured in [`env.schema.ts`](../src/config/env.schema.ts).)

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `INVITATION_ACCEPT_TOKEN_TTL_SECONDS` | `604800` (7d) | Upper bound for Redis token TTL; actual TTL is `min(this, seconds until invitation expiresAt)`. |

## RLS and bootstrap

- Invitees are not org members until accept completes, so they cannot satisfy `app_user_member_of_org` for `SELECT` on `invitations` or `organisations` in the same way as members.
- `POST /invitations/accept` is registered as an RLS bootstrap path (see [`rls-bootstrap.middleware.ts`](../src/common/middleware/rls-bootstrap.middleware.ts)) so Postgres sees `app_rls_bootstrap() = true` for that request.
- Security still depends on **Redis token → invitation id**, **JWT user email matching the invitation email**, expiry, and soft-delete checks in [`InvitationsService`](../src/invitations/invitations.service.ts).
- A migration widens `invitations_update` so bootstrap can soft-delete the invitation after membership insert (see `1779263063907-InvitationsUpdateAllowRlsBootstrap.ts`).

## Pagination reuse

Other list endpoints can return the same shape by returning a `PaginatedResult` from the handler; [`ResponseInterceptor`](../src/common/interceptors/response.interceptor.ts) unwraps it to `{ message, data: T[], meta }`. Shared pieces: [`PaginationQueryDto`](../src/common/dto/pagination-query.dto.ts), [`buildPaginationMeta`](../src/common/pagination/build-pagination-meta.ts), [`PaginatedResult`](../src/common/pagination/paginated-result.ts).
