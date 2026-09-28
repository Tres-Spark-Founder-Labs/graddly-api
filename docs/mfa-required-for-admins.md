# MFA for provider and employer admins

PRD §7.2 Security Requirements, **Authentication** (applies to: all portals):

> OAuth 2.0 with GOV.UK One Login primary; email/password with bcrypt hashing as
> fallback; MFA required for provider and employer admin accounts

This is the deployment procedure for that requirement. Read it before the
release that carries `MFA_REQUIRED_FOR_ADMINS`, and again before turning it on.

---

## What the flag does

`MFA_REQUIRED_FOR_ADMINS` — default `true`, declared in
`src/config/env.schema.ts`, read as `app.security.mfaRequiredForAdmins`.

While it is `true`, an account that holds an **active** `owner` or `admin`
membership of a **provider** or **employer** organisation and has
`mfaEnabled = false` sees this:

| Step                     | What happens                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in                  | Succeeds. `POST /auth/login` returns the usual tokens plus `mfaEnrolmentRequired: true`, and the access token carries an `mfaEnrol` claim.                                       |
| Any guarded route        | `403` with `code: MFA_ENROLMENT_REQUIRED` in the error body, alongside `statusCode`, `error`, `message`, `timestamp`, `path` and `requestId`.                                    |
| Routes that still answer | `POST /auth/mfa/enroll`, `/confirm`, `/verify`, `/disable`; `GET /auth/me`; `POST /auth/logout`; `POST /auth/logout-all`; `POST /auth/refresh`; and every unauthenticated route. |
| After enrolling          | The **same access token** starts working. `JwtAuthGuard` reads the live `mfaEnabled` on each request, so there is no re-login and no refresh to wait for.                        |

Not in scope: the `member` role anywhere, and any role in an apprentice or flow
organisation. A revoked membership and an invitation that has not been accepted
do not count either — the role has to be held now.

Turning the flag off does not remove anyone's MFA. It removes the wall for
people who have not enrolled yet.

---

## Who is affected

Measured against the production database while this change was built
(September 2026). Re-measure before the flip rather than trusting the number
here: it moves every time an organisation is created.

- 10 provider owners
- 6 employer owners
- **16 distinct people**, none of them with MFA enabled
- that set includes whoever runs the deploy

```sql
SELECT count(DISTINCT u.id) AS people
FROM organisation_memberships m
JOIN organisations o ON o.id = m."organisationId"
JOIN users u ON u.id = m."userId"
WHERE m.role IN ('owner', 'admin')
  AND m.status = 'active'
  AND m."isDeleted" = false
  AND o."isDeleted" = false
  AND u."isDeleted" = false
  AND u."mfaEnabled" = false
  AND o."portalType" IN ('provider', 'employer');
```

Swap the `count(DISTINCT u.id)` for `u.email, m.role, o.name, o."portalType"`
to get the list to contact.

---

## The rollout is a sequence, not a switch

The first deploy with the flag on locks all sixteen out of everything except
enrolment, at the same moment, including the person running the deploy. So:

1. **Ship with `MFA_REQUIRED_FOR_ADMINS=false`.** The release is then inert:
   nobody is flagged, no login response changes, no route starts refusing.
2. **Enrol the sixteen.** Contact them, walk them through it (see below), and
   confirm each one completes `POST /auth/mfa/confirm` — enrolment that starts
   and never confirms leaves `mfaEnabled` false and the person still exposed to
   the flip.
3. **Re-measure.** The query above must return `0`.
4. **Flip to `true`.** On Railway this is an environment-variable change, which
   restarts the service; the gate then applies from the next request.

**Rollback** is the same variable set back to `false`. It takes effect on the
next login and the next guarded request — there is no code to revert and no
data to undo. Nobody who has already enrolled is affected by it.

---

## Nobody in that set has ever used the enrolment flow

None of the sixteen has MFA enabled, which means none of them has been through
`POST /auth/mfa/enroll` and `POST /auth/mfa/confirm`. Sixteen first-time
enrolments in one day, on a path with no production use behind it, is a support
event as well as a technical one. Plan it as one:

- **Have a named person on call for it**, and do it in batches rather than all
  sixteen in one afternoon.
- **Expect the ordinary failures of first-time TOTP**: no authenticator app
  installed, a QR code scanned into the wrong app, and codes rejected because
  the phone's clock has drifted.
- **Recovery codes are shown once.** `POST /auth/mfa/confirm` returns eight
  single-use codes in its response and they are stored hashed, so they cannot
  be shown again. Somebody who closes that dialog without saving them has no
  second copy. Say this before they click, not after.
- **There is no administrative reset.** `POST /auth/mfa/disable`
  (`src/auth/mfa/mfa.controller.ts:139`) is self-service and requires a valid
  code: no endpoint lets one person clear another person's MFA. Someone who
  enrols and then loses both their authenticator and their recovery codes can
  only be unblocked by a direct database change (`users.mfaEnabled = false`,
  `mfaSecret = null`, `mfaRecoveryCodes = null`). That is a decision, not a
  support step — and because the audit trail is written by the TypeORM
  subscriber, a manual `UPDATE` leaves no record of who asked for it or why.
  Write it down somewhere that is not the database.

---

## What the frontend still needs

The API half is complete and the portals are not built against it yet. Two
things are outstanding there:

1. **Intercept `403` with `code: MFA_ENROLMENT_REQUIRED`** the way an expired
   token is intercepted, and route to the enrolment screen rather than showing
   a permission error. `mfaEnrolmentRequired: true` on the login response is
   the same signal one request earlier.
2. **Reach the enrolment screen from outside the dashboard.** `MfaSetup` lives
   under `app/(dashboard)/settings/...` in all four portals, so it renders
   inside a shell whose own requests will be refused for exactly the users who
   need that page. Whether the shell survives those 403s has not been tested.
   An enrolment route outside it is the safe version.

The login challenge that follows enrolment is already built: all four portals
have `MfaChallengeForm`, which posts to `POST /auth/mfa/verify` with the
`challengeToken` from the login response. That form also accepts a recovery
code.

---

## Related docs

- [Authentication tokens](./auth-tokens.md) — the idle timeout, the other §7.2
  session requirement
- [`.env.example`](../.env.example) — the variable and its neighbours
