# Authentication tokens

Graddly uses a short-lived **JWT access token** and a long-lived opaque **refresh token** stored in Redis.

## Policy (defaults)

| Token            | Default lifetime | Env var                              |
| ---------------- | ---------------- | ------------------------------------ |
| Access (JWT)     | **15 minutes**   | `JWT_ACCESS_EXPIRES_IN` (e.g. `15m`) |
| Refresh (opaque) | **7 days**       | `JWT_REFRESH_EXPIRES_IN` (e.g. `7d`) |

Durations use `s`, `m`, `h`, or `d` suffixes. Redis TTL for refresh tokens is derived from the same refresh duration so storage and policy stay aligned.

## Refresh rotation

`POST /api/v1/auth/refresh` exchanges a valid refresh token for a new access + refresh pair. The previous refresh token is deleted immediately (rotation).

## Idle timeout

PRD §7.2 Session management: _"JWT access tokens (15-minute expiry); refresh token rotation; forced re-authentication after 8 hours of inactivity"_.

Each stored refresh token carries the moment its family last refreshed (`refresh:<token>` holds `userId:version:lastActivityMs`). `POST /api/v1/auth/refresh` checks that stamp against `SESSION_IDLE_TIMEOUT_SECONDS` (default **28800**, eight hours) before rotating:

- **inside** the window — the token rotates as usual, and the replacement's stamp is now;
- **outside** it — `401` with `code: SESSION_IDLE_TIMEOUT`, and **every** refresh session for that user is revoked (version bump), not only the token presented.

**Activity means a refresh.** Requests made with a valid access token do not move the stamp, so the window is measured between refreshes and the granularity is the access token's 15 minutes: the worst case is a session surviving 8h15m of true inactivity. A client that refreshes on expiry stays signed in while it is open; a client closed for eight hours comes back to the sign-in screen.

The code is there so a client can tell this apart from an ordinary refresh-token expiry, which returns `401` without one. `src/auth/auth-error-codes.ts` carries the list.

Session state lives in Redis, protected by the key namespace and by the API holding the only credential — **not** by row-level security. Losing those keys ends sessions rather than extending them. Sessions already in flight when the timeout first deploys get one fresh window, because a stored token without the field is read as active now.

## Which revocations are audited

Revoking a session writes an `audit_log_entries` row against the account (`entityType: 'users'`, no actor: the refresh endpoint is unauthenticated, so claiming one would be a guess) in two cases:

| Case                                         | Recorded                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Idle timeout                                 | Yes — "All sessions revoked: idle for …"                                                                       |
| Reuse of a rotated token                     | Yes — "All sessions revoked: refresh token presented twice after rotation"                                     |
| `POST /auth/logout`, `POST /auth/logout-all` | No, deliberately. Signing yourself out is not a security event, and a row per logout would bury the two above. |

There is no endpoint for one person to end another person's sessions, so that third case has nothing to record yet.

## Reuse detection

After rotation, the old token is recorded in Redis as a short-lived tombstone (`REFRESH_REUSE_GRACE_SECONDS`, default **30**). If that token is presented again after rotation, the API treats it as a possible theft and **invalidates all refresh sessions** for that user (version bump). The client must log in again.

## Logout

| Endpoint                       | Effect                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| `POST /api/v1/auth/logout`     | Invalidates the refresh token in the request body             |
| `POST /api/v1/auth/logout-all` | Invalidates **all** refresh tokens for the authenticated user |

Access tokens are not blocklisted; they expire naturally (default 15m).

## Password reset

`POST /api/v1/auth/reset-password` bumps the refresh session version so existing refresh tokens no longer work.

## Related docs

- [JWT payload claims](./api/jwt-payload.md)
- [Password reset](./password-reset.md)
- [Email verification](./email-verification.md)
