# Learner data isolation — the measured baseline

> Extracted verbatim from `AUDIT.md` §6 on 12 August 2026 when that file was
> retired. Preserved because `OPEN_QUESTIONS.md` OQ-1 cites it as the evidence
> base for a UK GDPR escalation that is still open, and because the project
> root is not version-controlled. Now tracked in git.

---

## 6. LEARNER DATA ISOLATION — survey finding 4, settled

**Session P0-B, 10 August 2026. Status: CONFIRMED DEFECT, REMEDIATED.**
Previously carried as *UNVERIFIED*. It is no longer unverified, and the outcome
was not the benign one.

### 6.0 The policy this was measured against

**Client decision D3 — no learner may see, infer, or derive any other learner's
progress.** A standing platform policy, not a fix scoped to one endpoint. It
binds every current and future learner-facing feature.

It covers more than direct reads. It also covers every indirect route by which
one learner's position becomes inferable: rankings, percentiles, leaderboards,
cohort averages, comparison copy, searches or pickers returning other learner
identities, enumerable identifiers, response differences between "does not
exist" and "exists but is not yours", and cross-learner content in exports,
print views, PDFs or email bodies.

**D3 constrains the LEARNER role only.** Providers and employers legitimately
see learner progress within their own tenant — that is the platform's purpose.
Every finding below was fixed without narrowing provider or employer visibility,
and that is asserted by test rather than by inspection.

### 6.1 The root cause, which is not an OTJ bug

**There is no learner role in this platform.**

`AuthenticatedUser` is `User & { organisationId?: string; roles?: string[] }`
and that is all it carries. When an apprentice accepts their invitation they are
written into `organisation_memberships` as `role: OrganisationRole.MEMBER` of
the **provider's** organisation (`invitations.service.ts:253`) — byte-identical
to the row a tutor holds. `OrganisationRole` has exactly three values: `owner`,
`admin`, `member`.

The consequence is structural. Every guard in the codebase that asks *"is this
an authenticated member of this organisation?"* answers **yes** for a learner.
So every organisation-scoped query was, from a learner's seat, an unscoped one.
Survey finding 4 was one visible symptom of that, not the defect itself.

The only fact anywhere in the schema that says "this login is that apprentice"
is `enrolments.apprenticeUserId`.

### 6.2 Step 1 — enumeration

Derived mechanically from controller sources rather than from `openapi.json`,
because the published spec records paths but not who may call them, and who may
call them is the entire question.

| | Count |
|---|---|
| Total mapped routes | **267** |
| Reachable by an authenticated `MEMBER` (i.e. by a learner) | **214** |
| Blocked by capability, role, or absence of a JWT guard | 53 |
| Of the 214, returning or capable of returning learner-attributable data | **63** |

The 53 blocked routes are blocked by `@RequiresCapability` (ILR submission, QIP
and SAR management, staff management, tutor caseload assignment, organisation
update and delete, OTJ bulk approve and reject, survey and subscription
management) or are unauthenticated by design (auth, health, public survey
tokens, OAuth callbacks, ops queues).

### 6.3 Step 2 — categorisation, with the mechanism quoted

Every one of the 63 was traced for **learner scope** and **tenant scope**
separately.

**Category (a) — scoped by authenticated principal. 9 paths. No defect.**

| Path | Mechanism (quoted) | Tenant scope |
|---|---|---|
| `GET /learners/me/summary` | `apprenticeUserId: user.id` — `learner-me-summary.service.ts:41` | `organisationId` in same `where` OK |
| `GET /learners/me/documents` | `apprenticeUserId: user.id` — `learner-documents.service.ts:59` | same `where` OK |
| `GET /notifications` | `.where('n.userId = :userId', { userId })` — `notifications.service.ts:32` | optional org filter OK |
| `PATCH /notifications/:id/read` | `where: { id, user: { id: userId } }` — `:57` | via user OK |
| `PATCH /notifications/read-all` | `.where('"userId" = :userId')` — `:79` | org filter OK |
| `GET /messaging/threads/unread-count` | `{ ...base, apprenticeUserId: user.id }` OR `{ ...base, counterpartyUserId: user.id }` — `message-threads.service.ts:214-215` | base carries org OK |
| `GET /auth/me`, `PATCH /auth/me`, digest preference read and write | principal by construction | n/a |

**Category (b) — request parameter with a server-side authorisation check.
4 paths. No defect.**

| Path | Check (quoted) |
|---|---|
| `GET /messaging/threads/:id` | `assertCanRead` → `thread.apprenticeUserId === userId \|\| thread.counterpartyUserId === userId` — `messaging-access.service.ts:25` |
| `GET /messaging/threads/:threadId/messages` | same |
| `POST /messaging/threads/:threadId/messages` | `assertCanWrite` → `isParticipant` only; admins deliberately excluded from writing — `:45` |
| `GET /messaging/threads` (list) | SQL is over-broad (`t.organisationId = :organisationId OR t.apprenticeUserId = :userId OR ...` — `:80`) but the result is filtered in application code by `accessService.canRead` — `:98`. **Correct, but it fetches the organisation's threads in order to discard them.** Recorded as a performance observation, not a security finding. |

`MessagingAccessService` was the only place in the codebase doing
principal-based authorisation properly, and it is the model the fix follows.

**Categories (c) and (d) — the defect. 50 paths.**

(c) accepts an id and trusts it; (d) returns records across learners. Both were
one org-scoped `where` away from being correct, and neither had a principal
check of any kind.

| Representative path | Mechanism as inherited | Cat |
|---|---|---|
| `GET /otj-log-entries` | `otj.organisationId = :organisationId`; the `query.apprenticeId` filter is **optional** — `otj-log-entries.service.ts:109,135` | (d) |
| `GET/PATCH/DELETE /otj-log-entries/:id` | `findAccessibleEntry` → `where: { id, organisationId, isDeleted: false }` — `:433` | (c) |
| `POST /otj-log-entries` | `assertEnrolmentMatch` proved org membership and that the apprentice matched the enrolment — both true of *every other learner's* enrolment | (c) |
| `GET /apprentices`, `GET/PATCH/DELETE /apprentices/:id` | `where: { organisationId: user.organisationId! }` — `apprentices.service.ts:64,78` | (d)/(c) |
| `GET /enrolments` | `buildEnrolmentListWhere(user, portalType)` narrows to `apprenticeUserId` **only** for `PortalType.APPRENTICE`, and the portal type comes from the client's own `X-Portal-Type` header, where "explicit header wins" — `enrolment-portal-scope.util.ts:14,29`. A learner selected their own scope by omitting a header. | (d) |
| `GET /enrolments/:id` | tries PROVIDER, FLOW, EMPLOYER, APPRENTICE in order and returns the first match — PROVIDER matches any enrolment in the org — `enrolments.service.ts:248` | (c) |
| `GET /learners/cohort`, `/cohort/filter-options`, `POST /cohort/export` | org-scoped; returns learner name, employer, standard, OTJ percentage, next review, EPA date and tutor for the whole cohort | (d) |
| `GET /learners/caseload`, `GET /learners/intervention-queue` | org-scoped | (d) |
| `GET /learners/:enrolmentId/profile` | `where: { id: enrolmentId, organisationId }` — `learner-profile.service.ts:67` | (c) |
| `GET /reviews`, `GET /reviews/:id`, and 6 write paths | org OR linked-party; `findEntity` → `where: { id, organisationId }` — `reviews.service.ts:308` | (d)/(c) |
| `GET /ksb-evidence-items` and 8 single-item paths | `findEntity` → `where: { id, organisationId }` — `ks-evidence-items.service.ts:392` | (d)/(c) |
| `GET /portfolio/ksb-heatmap` | org-scoped, `enrolmentId` from the client, and **checked after a cache read** | (c) |
| `POST /storage/download-url` | `belongsToOrganisation(key, organisationId)` — `storage.service.ts:63` — compares only the `orgs/{id}/` prefix. Keys are `orgs/{org}/learners/{apprenticeId}/evidence/…`; the learner segment was never compared against the caller. | (c) |
| `GET /pdf/jobs/:id` | `where: { id: jobId, organisationId }` — `pdf-jobs.service.ts:43`. `resultKey` presigns to a rendered cohort table or learner profile. | (c) |
| `GET /commitment-statements` and 4 related | `statement.organisationId = :organisationId` — `commitment-statements.service.ts:171` | (d)/(c) |
| `GET /ilr/learner-records` and 3 related, `GET /ilr/funding-claims` | org-scoped | (d)/(c) |
| `GET /audit/export`, `GET /reporting/provider-dashboard`, `GET /surveys/campaigns/:id/results`, the three `*-pushes/failed` lists | org-scoped | (d) |

**Tenant scoping held everywhere.** Every one of the 63 was also traced for
tenant scope and every one was tenant-correct. No learner-scoped query was
missing a tenant filter, and no cross-tenant test failed at any point — before
or after the fix. **The breach was strictly inside a single training provider's
cohort.**

### 6.4 Step 3 — indirect leakage, each reported explicitly

| Route | Present? | Evidence |
|---|---|---|
| Ranking, percentile, leaderboard | **Absent** | No `rank`, `percentile`, `median`, or ordering-against-peers anywhere in learner-reachable code. |
| Cohort average surfaced to a learner | **Absent** | `provider-dashboard.service.ts` exposes `cohortCount` only (`:55`) — a count, not a distribution — and that route is not learner-reachable after the fix. |
| Comparison copy ("ahead of / behind most learners") | **Absent** | No such string in any of the four apps. Pace copy compares a learner to *their own* required pace, never to peers. |
| Search, autocomplete, or picker returning other learner identities | **PRESENT — fixed** | `GET /enrolments/employer-manager-options` and `GET /enrolments/:id/participant-options` returned org member identities; `GET /learners/cohort/filter-options` returned tutor and employer option lists. All now denied to learners. |
| Sequential or guessable identifiers | **Absent** | Every identifier is a v4 UUID (`BaseEntity`), and `ParseUUIDPipe` rejects malformed ids. Not guessable — though note the exposure never required guessing, because the list endpoints handed the ids out. |
| 404-vs-403 existence disclosure | **PRESENT — fixed** | Refusals now return `404` carrying Nest's own unmatched-route message. Asserted by test: a record that is not yours and a record that does not exist are identical in status **and** in message. |
| Cross-learner content in exports, print views, PDFs, email | **PRESENT — fixed** | `POST /learners/cohort/export` renders the whole cohort to PDF, and `GET /pdf/jobs/:id` was org-scoped, so a learner could poll another learner's job and presign the result. The export route is now denied to learners and job polling is narrowed to `requestedByUserId`. Email bodies were checked: `notifyApprenticeOfDecision` addresses one recipient and quotes only their own entry — no cross-learner content. |

### 6.5 Step 5 — the fix, at one shared layer

Two mechanisms, each written once.

**1. `LearnerScopeService`** (`src/common/learner-scope/`) — the single answer to
"is this principal a learner here, and what is theirs". A principal is a learner
in the active organisation when they are not an owner or admin **and** either
hold an enrolment naming them as `apprenticeUserId` or hold an
apprentice-origin invitation (`invitations.enrolmentId IS NOT NULL`). The second
condition exists so that a missing `apprenticeUserId` stamp cannot fail *open*.
Results are memoised on the request-scoped `AuthenticatedUser` object.

It returns `null` — never an empty array — for staff, so a call site can
distinguish "do not narrow" from "narrow to nothing". An empty array would have
silently blanked the provider's approval queue.

**2. `LearnerScopeInterceptor`** (global) — denies every organisation-scoped
route to a learner unless the handler carries `@LearnerAccessible()`.
**Deny-by-default is the point.** Reachability was the default and scoping was
something each endpoint had to remember, which is precisely how this happened.
Inverted, a route added next year is closed to learners until somebody decides
otherwise.

It is an interceptor and not a guard for a concrete reason: Nest runs
globally-registered guards **before** controller-bound ones, so an `APP_GUARD`
would execute ahead of `JwtAuthGuard`, see no `req.user`, resolve "not a
learner", and fail **open** on every request. A global interceptor runs after
the whole guard chain.

**46 routes** carry `@LearnerAccessible()`, leaving **168 of the 214** closed to
learners outright. The allowlist was derived from the apprentice app's own
request paths, not guessed.

**That derivation was not sufficient on its own, and the suite caught it.**
`test/portfolio/epa-pack-jobs.e2e-spec.ts` creates an EPA evidence pack *as the
apprentice* — a learner generating their own portfolio pack, which is plainly
legitimate — and the first version of this fix returned 404 on it. The
apprentice frontend does not call that endpoint yet, so deriving the allowlist
from frontend request paths measured what the portal happens to do today rather
than what the backend intends. Two routes were added
(`POST /portfolio/epa-pack-jobs`, `GET /portfolio/epa-pack-jobs/:id`); no row
scoping was needed, because that service already consults
`requireEnrolmentForUser` → `canAccessEnrolment` on both, making it one of the
few genuine category (b) paths that existed before this work.

Recorded rather than quietly patched, because it is the honest limit of the
method: an allowlist derived from one client describes that client, and a route
a future portal screen needs will hit the same 404 until somebody marks it. The
failure mode is a visible 404 rather than a silent leak, which is the direction
this trade-off should fail in.

Route admission is not row scoping, so the allowlisted collection routes
additionally narrow their queries through `ownEnrolmentIds`, at the lowest
shared point each module already had:

| Module | Point |
|---|---|
| OTJ | `findAccessibleEntry` (behind `findOne`, `update`, `remove` and the bulk transitions) and `findAll`; `assertEnrolmentMatch` for the write side |
| Enrolments | `findOne` and `findAll` |
| Reviews | `findEntity` (guards every write path), `findAll`, `findOne` |
| Portfolio evidence | `findEntity` (8 call sites), `findAll`; `canAccessEnrolment` on create |
| KSB heatmap | before the cache read, not after |
| PDF jobs | `requestedByUserId` |

### 6.6 Evidence

`test/otj-learner-scope.e2e-spec.ts` and `test/learner-scope-surface.e2e-spec.ts`,
on a fixture (`test/helpers/learner-scope-e2e.ts`) that puts **two learners in
one provider organisation** — a scenario no pre-existing fixture could express,
which is why nothing ever failed on this before.

**Before the fix**, against the code as inherited:

```
● does not return another learner in an unfiltered list
    Received: {"data":[{…"apprenticeName":"Bee Learner",…
               "activityName":"APPRENTICE-B-PRIVATE-SESSION"…}],"meta":{"total":2}}
● does not return another learner by direct id
● cannot modify another learner entry
    Expected value: 200   Received array: [403, 404]
```

That third failure is the one to read twice: the PATCH returned **200**. One
learner could *edit* another learner's funding-relevant training record.

A methodological note, because it nearly produced a false clearance: the first
draft asserted that `/learners/cohort` did not contain another learner's
`apprenticeId`, and it passed — because the cohort DTO carries `enrolmentId` and
`learnerName` and never carries `apprenticeId` at all. That assertion would have
passed just as happily with every guard deleted. Every negative is now paired
with a staff-side positive that must contain the same marker, so a wrong marker
fails loudly instead of passing quietly.

### 6.7 What this does not close

- **Only the API is fixed.** The four frontends were not audited for D3 in this
  session beyond deriving the allowlist from the apprentice app's request paths.
- **The `MEMBER`-means-two-things design remains.** The fix infers learner
  identity from `enrolments.apprenticeUserId`; it does not introduce the learner
  role the platform actually lacks. That is the durable fix and it is a larger
  change — recorded, not silently deferred.
- **An owner or admin who is also enrolled is treated as staff.** Deliberate:
  reversing it would lock an administrator out of their own portal the moment
  somebody enrolled them.
- **Whether real learner data was exposed in production is not answerable from
  source.** Escalated as `OPEN_QUESTIONS.md` OQ-1, a UK GDPR notification and
  DPIA question for the client and their DPO. Not ours to close.
