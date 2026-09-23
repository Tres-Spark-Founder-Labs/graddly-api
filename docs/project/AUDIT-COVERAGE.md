# Audit coverage — which entities produce a trail, and which do not

78 entity classes. **46 audited, 32 not.**

Auditing happens in `AuditLogSubscriber`, gated by two hand-maintained lists in
`src/audit/audit-organisation-id.resolver.ts`:

- `isAuditedEntity` — does this entity produce a row at all?
- `resolveAuditOrganisationId` — which organisation does that row belong to?

`audit-coverage.spec.ts` now fails when those two disagree in either direction.
That test exists because four faults had accumulated unnoticed; see the bottom
of this file.

`AUDITED_ENTITIES` in `audit.constants.ts` is **not** the switch. It predates
the resolver, nothing imports it, and adding a class to it audits nothing. It
is kept for the reasoning written beside each entry.

---

## The five added in the audit coverage pass

Each recorded a decision about a person with nobody's name against it.

| class                       | table                          | organisation               |
| --------------------------- | ------------------------------ | -------------------------- |
| `User`                      | `users`                        | its own branch — see below |
| `SafeguardingChecklistItem` | `safeguarding_checklist_items` | `organisationId`           |
| `EpaOutcomeRecord`          | `epa_outcomes`                 | `organisationId`           |
| `BreakInLearning`           | `break_in_learning`            | `organisationId`           |
| `FundingClaimResolution`    | `funding_claim_resolutions`    | `organisationId`           |

### `User`: resolved through membership, not left null

A user belongs to no organisation, so `users` needed a decision rather than the
`return null` at the foot of the resolver. Leaving it null would have repeated
the `programmes` fault exactly: the RLS SELECT policy on `audit_log_entries`
and `audit-export.service.ts:125` both compare `organisationId` to the caller's
organisation, and `NULL = uuid` is never true, so the row is written where no
tenant can read it. For an account-takeover trail, unreachable and absent are
the same thing.

The branch resolves, in order:

1. **the subject's own membership**, when the relation is loaded. The record
   belongs to the organisation whose person it is — an administrator editing a
   user from a second organisation must not file the evidence somewhere that
   user's own administrators cannot see it.
2. **the acting organisation context**, which is what the ordinary save path
   gives, since `memberships` is not loaded on it. The actor can always
   retrieve what they did.

It is still null for **signup and OIDC provisioning**: a user exists before any
membership and outside any organisation context (F1.2.5 AC1/AC3 — "invited"
and "account created" both precede membership). No tenant can own that row, and
filing a stranger's account creation inside an organisation they have not
joined would be worse than leaving it at the platform level, where
`app_rls_bootstrap()` can still read it. The membership that follows is audited
in its own right.

`test/audit.e2e-spec.ts` proves the reachable case through the real export
endpoint rather than by reading the table.

### What `User` auditing captures, method by method

The subscriber fires on `repo.save()` and **not** on `repo.update()`, so the
write path decides whether a change is recorded. `users.service.ts` after the
6.4 conversion:

| method                     | mechanism                 | what the trail shows                                   |
| -------------------------- | ------------------------- | ------------------------------------------------------ |
| `create`, `createFromOidc` | save                      | the account being created                              |
| `updateProfile`            | save                      | name, phone, job title, and the rest, before and after |
| `markEmailVerified`        | save (was `update`)       | `isEmailVerified` false → true                         |
| `enableMfa`                | save (was `update`)       | `mfaEnabled` false → true                              |
| `disableMfa`               | save (was `update`)       | `mfaEnabled` true → false                              |
| `updatePassword`           | explicit event            | "Password changed"                                     |
| `setPendingMfaSecret`      | explicit event            | "Multi-factor authentication enrolment started"        |
| `setMfaRecoveryCodes`      | explicit event            | "Multi-factor recovery code used (_n_ remaining)"      |
| `updateLastLoginAt`        | **nothing, deliberately** | see below                                              |

The three credential writes cannot go through the subscriber even in
principle. Their only changed columns are `password`, `mfaSecret` and
`mfaRecoveryCodes`, all excluded from every payload, so a `save()` would diff
to nothing and `afterUpdate` would return before writing a row — coverage that
reads as done and is silence. They record an explicit `AuditEventService`
event instead: the action, the actor and the time, with **no payload**. That is
the same pattern `erasure.service.ts` uses, and for the same reason.

`updateLastLoginAt` stays a bulk `update()` and writes no audit row. Every
successful sign-in touches it, and this table is append-only for seven years,
so auditing it would fill the trail an investigator reads with logins.
`lastLoginAt` is itself the current answer and sign-in activity belongs in the
authentication logs. It is an exclusion, not an oversight, and
`users.service.spec.ts` asserts the silence so that converting it to `save()`
breaks a test that says why.

A user's **role** is not on this entity. It is per-organisation on
`organisation_memberships`, which was already audited.

**There is still no email-change path in the service at all** — `updateProfile`
does not touch `email`, and nothing else does. So the takeover path this
coverage was built for cannot currently be walked through the API. Whether
that is deliberate or a missing capability is a product question, not an audit
one, and it is open.

### Credentials never enter the table

`changes` is before/after JSON, the table is append-only by trigger (migration
1781100000027), and retention is seven years. A credential written into it
cannot be corrected or deleted afterwards. Personal data is different: the GDPR
routine rewrites names and email addresses in place through
`scrubAuditChanges`, which is also what makes auditing a user's email change
compatible with an erasure request.

`AUDIT_EXCLUDED_FIELDS` therefore holds `password`, `passwordHash`, `mfaSecret`,
`mfaRecoveryCodes`, `accessTokenEncrypted`, `refreshTokenEncrypted`, `p256dh`
and `auth`. `audit-credential-scrub.spec.ts` asserts it twice over: that no
built payload carries a credential key or a bcrypt-shaped value, and that no
audited entity has a credential-shaped column missing from the list.

---

## The 32 unaudited classes

### Deliberate — no user action to record (15)

These record work the system did to itself. A trail would say "a queue ran",
which the queue's own state already says.

| class                            | why not                                                                                                                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuditLogEntry`                  | Auditing the audit log recurses. Immutability is enforced by trigger instead.                                                                                                                                                                                                     |
| `PdfGenerationJob`               | Job state. The document it produces is audited.                                                                                                                                                                                                                                   |
| `EpaPackJob`                     | Job state.                                                                                                                                                                                                                                                                        |
| `EvidencePackJob`                | Job state.                                                                                                                                                                                                                                                                        |
| `EnrolmentSubmissionPush`        | DAS delivery attempt; `das_api_activity` is the record of the call.                                                                                                                                                                                                               |
| `EnrolmentCompletionPush`        | As above.                                                                                                                                                                                                                                                                         |
| `ReviewReminderDispatch`         | Dispatch ledger, written by cron, deduplicates reminders.                                                                                                                                                                                                                         |
| `EnrolmentMilestoneNotification` | Marker ledger for the F3.4.3 AC2 sweep, written by cron. It exists to stop a notification firing twice; the notification itself is the record.                                                                                                                                    |
| `RetentionRunLog`                | Its own audit record — a log of a retention run.                                                                                                                                                                                                                                  |
| `DasApiActivity`                 | Already the API call log; auditing it duplicates itself.                                                                                                                                                                                                                          |
| `MessageThreadRead`              | A read marker, written on every thread open. High volume, no decision.                                                                                                                                                                                                            |
| `PushSubscription`               | A browser's own push registration. It also holds the Web Push keys `p256dh` and `auth`, which is a second reason to keep it out of a table nothing can be deleted from — and neither name is caught by the credential pattern, so both are pre-listed in `AUDIT_EXCLUDED_FIELDS`. |
| `UserOidcIdentity`               | Identity-provider link, managed by the OIDC flow.                                                                                                                                                                                                                                 |
| `FlowportalRegistrationSession`  | Short-lived wizard state, discarded on completion.                                                                                                                                                                                                                                |
| `AiProgrammeProgress`            | Per-module progress ticks; the enrolment and completion are audited.                                                                                                                                                                                                              |

### Probably deliberate, worth confirming (8)

Unchanged by this pass — these are still open questions, not decisions.

| class                    | why not, and the doubt                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AiProgrammeModule`      | Catalogue content, not customer data. But it is editable, and nothing records who changed a module.                                                      |
| `AiProgrammeCompletion`  | Completion of an AI programme. Arguably a learner outcome and arguably a progress tick.                                                                  |
| `NotificationPreference` | A user's own setting. Low stakes unless someone disables another user's alerts.                                                                          |
| `Notification`           | High volume, machine-generated. The action that caused it is audited at source.                                                                          |
| `ProgrammeDocument`      | Uploaded file metadata; the storage layer keys are recorded.                                                                                             |
| `IlrMappingConfig`       | Versioned in its own table with `status` and `publishedAt`, so it has a history of a different shape.                                                    |
| `ReportSubscription`     | Who receives a scheduled report. Changing it is a small disclosure decision.                                                                             |
| `SignatureRecord`        | The e-signature artefact. `commitment_signatures` and `review_signatures` are both audited, so the act of signing is covered — this is the stored image. |

### Gaps still open (9)

Every one carries a stated reason for remaining out, and every reason is a
ranking against the five above rather than a client decision.

| class                   | why it looks like a gap                                      | why it is still out                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InterventionAction`    | F2.2.2. What a tutor did about an at-risk learner.           | It carries `createdByUserId`, so the _who_ of the original entry survives; what is missing is the history of later edits and completions. Attribution exists, history does not — which ranked it below rows with no attribution at all.                                                                                 |
| `EifScoreSnapshot`      | Ofsted evidence. Inspectors ask who produced a figure.       | Written only by the nightly `eif-snapshot` cron (`captureAll` → `captureForOrganisation`); `eif-scores.controller.ts` exposes reads alone. There is no user action to attribute, and the inputs it derives from — QIP actions, safeguarding items — are audited at source. Closer to the deliberate list than to a gap. |
| `SarReport`             | Self-assessment report, edited and then locked.              | A genuine gap: `generate`, `update` and `lock` all persist through `repo.save()`, so adding it is only a list entry. Left out because it is an internal provider document rather than a record about an individual, and `lockedAt` gives a coarse history that a learner-facing row does not have.                      |
| `EmployerVisit`         | F2.4.2. A visit record is evidence.                          | It carries `recordedByUserId`, so the visit names its author; the missing part is edits after the fact. Same shape as `InterventionAction`.                                                                                                                                                                             |
| `EmployerVisitLearner`  | Which learners a visit covered.                              | A join row with no attribution of its own, but adding or removing a learner is only meaningful alongside the parent visit, which should be audited first. Out until `EmployerVisit` is in.                                                                                                                              |
| `SurveyTemplate`        | F2.4.3. Who wrote the question affects how the answer reads. | Provider-authored content with no personal data in it; ranked below rows that decide funding, safeguarding or a learner's result.                                                                                                                                                                                       |
| `SurveyCampaign`        | Who sent it and to whom.                                     | Same ranking. The campaign's recipients are derivable from the invitations it created.                                                                                                                                                                                                                                  |
| `SurveyInvitation`      | Contains a recipient token; a disclosure record.             | Out for a second reason as well as ranking: `tokenHash` would have to be excluded before it could be audited, exactly as the DAS tokens were this pass. Auditing it without that would put a credential hash in the append-only table.                                                                                  |
| `LevyTransferEnrolment` | Which enrolments a transfer funds.                           | A join row written by `levy-transfer-funding.service.ts`; the transfer itself is audited, and the set of enrolments is reconstructable from it. Weakest of the nine.                                                                                                                                                    |

---

## The four faults this file was written after

Found by diffing the two lists against each other:

| entity                    | fault                                      | effect                                                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DasLevyMonthlyEntry`     | in resolver, absent from `isAuditedEntity` | never audited                                                                                                                                                                                                                                                             |
| `DasFundingPayment`       | same                                       | never audited                                                                                                                                                                                                                                                             |
| `CommitmentChaseDispatch` | same                                       | never audited                                                                                                                                                                                                                                                             |
| `Programme`               | audited, no resolver branch                | **worse** — the row is written with `organisationId: null`, and `audit-export.service.ts:50` filters on `audit.organisationId = :organisationId`. `NULL = uuid` is never true in SQL, so the row exists and no tenant can retrieve it. The report shows nothing happened. |

All four are fixed. `audit-coverage.spec.ts` fails if any recurs, in either
direction — verified by reintroducing one of each and watching the
corresponding assertion fail, and re-verified for `User` in both directions
during the coverage pass.

## Three things the coverage pass found

| finding                                               | detail                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DAS OAuth tokens could reach the trail, and never did | See the section below. Found by the credential test written for `User`, not by looking. Both columns are now excluded.                                                         |
| `AUDITED_ENTITIES` is dead                            | A second list of audited classes, in `audit.constants.ts`, that nothing imports. Three of its five entries were not audited at all until this pass. It now says so at the top. |
| `repo.update()` is a blind spot                       | TypeORM subscribers do not fire for `update()` or QueryBuilder writes. Swept across all 46 audited entities; results below.                                                    |

---

## The DAS donor OAuth tokens: measured, not estimated

`accessTokenEncrypted` and `refreshTokenEncrypted` were not excluded from audit
payloads until the coverage pass. `DasDonorOAuthToken` is audited, its
`upsertToken` path in `das-donor-link.service.ts:190` persists through
`repo.save()` on both branches, and both columns are ordinary selected text.
So **any successful token write would have carried both values into `changes`**,
in a table whose UPDATE and DELETE are refused by trigger, kept for seven
years.

Counted on **23 September 2026**, as the `graddly` superuser role
(`rolsuper` and `rolbypassrls` both true, so RLS hid nothing):

| database                      | audit rows | rows carrying either token field | `das_donor_oauth_tokens` rows | donor links              |
| ----------------------------- | ---------- | -------------------------------- | ----------------------------- | ------------------------ |
| `graddly` (persistent, local) | 557        | **0**                            | **0**                         | 7 across 6 organisations |
| `graddly_test` (ephemeral)    | 2,820      | **0**                            | 4                             | 4                        |

No audit row in either database carries any credential-shaped key at all —
`password`, `secret`, `token`, `hash`, `recovery`, `apikey`, `privatekey`,
`p256dh` or `auth`, checked with `jsonb_object_keys`.

**Why zero, and what that does and does not prove.** The persistent database
has never held a donor OAuth token row, so there was nothing to write. The test
database is truncated at the start of every e2e run, and its four rows were
written _after_ the exclusion landed: their `changes` keys are exactly
`donorLinkId`, `expiresAt`, `organisationId`, `scope`. Those four rows are also
the proof that the subscriber fires on this entity — the path was live, and
before the exclusion it would have recorded both values.

**Was any of it ever real?** Not in either database here, and not possible in
this environment: `.env` sets none of the six `DAS_DONOR_OAUTH_*` variables and
no `DAS_DONOR_TOKEN_ENCRYPTION_KEY` (the schema defaults each to `''`), so the
consent flow cannot complete and no ESFA-issued token can be obtained. The
seven donor links in the persistent database are direct-entry rows with no
token attached.

**What this machine cannot answer.** Only `localhost` is reachable from here,
so a deployed database may hold rows this count cannot see. Whoever has that
access should run:

```sql
SELECT count(*)                          AS rows,
       count(DISTINCT "entityId")        AS token_records,
       count(DISTINCT "organisationId")  AS organisations,
       min("createdAt"), max("createdAt")
  FROM audit_log_entries
 WHERE changes ? 'accessTokenEncrypted'
    OR changes ? 'refreshTokenEncrypted';
```

as a role with `rolbypassrls`, or under `app_rls_bootstrap()`; a tenant-scoped
connection will under-report. If that returns rows, **rotation comes before
redaction**: revoking the affected donor tokens at ESFA invalidates what
leaked, whereas editing an append-only log alters the record of it. The
retention probe already suspends the immutability trigger safely, so redaction
stays available as a second step — but it needs a decision, and it is not
reversible.

Nothing in the audit table has been edited.

---

## `save()` versus `update()`, swept across all 46 audited entities

Being in `isAuditedEntity` is not coverage. `AuditLogSubscriber` reads
`event.entity.constructor`, and only `save()`, `softRemove()`, `remove()` and
`recover()` hand it a real entity instance. `update()`, `insert()`, `upsert()`,
`delete()`, `softDelete()`, QueryBuilder writes and raw SQL all pass a plain
object or nothing, so the entity is listed as audited and the write produces no
row.

Every write path to every audited entity was read. Method: map each
`@InjectRepository(X)` to its variable, classify every call on it, plus
`manager.<method>(Entity, …)` and raw SQL against an audited table, then verify
each hit by reading the code. Two static hits were false — `OrganisationMembership`
and `KsEvidenceKsbMapping` looked uncovered because the `create` and the `save`
are on separate lines; both are audited.

### Coverage that does not exist

| entity             | write                                                                                                                                      | effect                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Organisation`** | `organisations.service.ts:81` creates the row with raw SQL `INSERT INTO organisations` — RLS blocks `RETURNING` before a membership exists | **organisation creation produces no audit row at all.** The entity is in `isAuditedEntity` and has its own resolver branch; edits (2 save paths) are audited, the creation is not. The membership created in the same transaction _is_ audited, so the event is inferable from "X became owner of an organisation", which is not the same as recording that the organisation was created |

### Coverage with a hole in it

| entity                 | write                                                                                                      | effect                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DasLevyMonthlyEntry`  | `das-manual.service.ts:112` — `replaceMonthlyEntries` deletes every row for the organisation, then inserts | the inserts are audited, the deletion is not, so a **manually entered levy figure being lowered reads as an addition**. Confirmed in the dev database: 128 insert rows, 60 live rows, **0 delete rows**. The previous values are still recoverable from the earlier insert rows; a month removed entirely leaves nothing but an absence |
| `DasLevyTranche`       | `das-manual.service.ts:151` (user-entered) and `das-donor-sync.service.ts:50` (machine sync)               | same replace pattern, same hole                                                                                                                                                                                                                                                                                                         |
| `KsEvidenceKsbMapping` | `ks-evidence-items.service.ts:247` deletes the old mappings before saving the new ones                     | a re-mapping shows KSBs appearing and never disappearing                                                                                                                                                                                                                                                                                |
| `Apprentice`           | `break-in-learning.service.ts:95,145` — `apprenticeRepo.update()` flips status to `paused` / `active`      | the status change is unattributed, but the `BreakInLearning` row that caused it is audited and carries `recordedByUserId` / `endedByUserId`, so the actor is recoverable                                                                                                                                                                |

### Bypasses that are correct, and now say so

| entity                                                                | write                                                                          | why it is right                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Enrolment`                                                           | `otj-inactivity.service.ts:197` stamps `otjInactivityAlertedAt` via `update()` | a cron dedupe marker with no actor. Auditing it would add an actorless row per alert per apprentice per week                                                 |
| `OtjLogEntry`, `Message`, `BreakInLearning`, `FundingClaimResolution` | `erasure.service.ts` QueryBuilder `.update()`                                  | a GDPR erasure must **not** write the erased values into an append-only table; `recordErasureAudit` writes a purpose-built row with no personal data instead |
| `Message`, `MessageThread`, `Invitation`                              | `data-retention.service.ts:189` batch `delete()` of rows already soft-deleted  | the soft delete was audited when the user made it; the physical purge is recorded in `RetentionRunLog`                                                       |

### One more thing the sweep turned up

`src/config/data-source.ts` — the DataSource the seed scripts and migrations
use — registers **no subscribers**, while the application's
`typeorm-module.factory.ts` registers `**/*.subscriber.ts`. So everything
`seed-test-data.ts` writes is unaudited by construction. That is correct (no
user did it), and worth knowing before someone opens the trail on a demo
tenant and reads the emptiness as a fault. It is also why the dev database
shows 0 audit rows against 26 seeded users and 147 seeded reviews, while the
entities exercised through the running app — `Enrolment`, `OtjLogEntry`,
`DasLevyBalance`, `DasLevyMonthlyEntry`, `DasDonorLink`, `DasLevyTranche` — all
have rows.

### What would close the blind spot generally

Nothing enforces the rule today: any service that switches a `save()` to an
`update()` silently removes the trail for that entity, and the change looks
like a performance improvement in review. A spec that fails when an audited
entity's repository is called with a bypassing method — the sweep above, run as
a test rather than as a one-off — is the shape that would hold it.
