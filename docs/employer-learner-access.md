# Employer access to apprentices and learner profiles

> F1.2.1 works for the employer. F1.2.2’s endpoint now serves them too, the
> tutor’s name included, but **F1.2.2 is not met**: "F1.2.2, criterion by
> criterion" lists what is still missing — the provider’s name (AC1), two
> things the API already serves and the drawer does not show (AC2, AC4), a
> chart that does not exist (AC3), downloads (AC5) and messaging (AC6).
> "Bootstrap is for named, narrow reads" is a rule rather than a description: read
> it before adding a `setRlsBootstrap` call anywhere.
> Referenced from `test/employer-learner-access.e2e-spec.ts`.

---

## The defect

Two Phase 1 **Must Have** features on the employer portal failed for every
employer account, on every deployment, since the endpoints were written.

| Feature                                  | Endpoint                             | Symptom      |
| ---------------------------------------- | ------------------------------------ | ------------ |
| F1.2.1 All-Apprentice Overview Dashboard | `GET /apprentices`                   | roster empty |
| F1.2.2 Individual Learner Profile        | `GET /learners/:enrolmentId/profile` | flat 403     |

Both now work. F1.2.1 needed one query rewritten; F1.2.2 needed three layers
to agree, and is the more instructive of the two.

Neither is a data problem. Both are the same modelling mistake made twice: the
code asked "which organisation owns this row?" when the question F1.2.1 AC1
actually poses is _"every active apprentice **across all training providers**"_
— an employer's roster is not a set of rows they own.

An `Apprentice` row is stamped with the organisation that created it, which is
the provider. So `where: { organisationId: user.organisationId }` returns
nothing for an employer by construction, and no amount of correct data changes
that.

`PRD-CONFORMANCE.md` marks F1.2.1 **CONFORMS** on the evidence that the route
calls `/apprentices`. It did call it. It got an empty array. This is the
failure mode `CLAUDE.md` describes: endpoint-existence proves fabrication, and
proves nothing else.

---

## What was fixed — F1.2.1

`apprentices.service.ts` `findAll` now branches on the caller's portal type.

- **Provider and every other portal**: unchanged. `apprentice.organisationId =
:organisationId`.
- **Employer**: `EXISTS (SELECT 1 FROM enrolments e WHERE e."apprenticeId" =
apprentice.id AND e."isDeleted" = false AND e."employerOrganisationId" =
:organisationId)`.

### Why derive rather than add a column

PRD §9.2 gives an apprentice exactly one employer and one provider at a time,
and `Enrolment` already carries both. A second owner column on `Apprentice`
would duplicate a relationship modelled correctly one table over, and leave two
places free to disagree about who the employer is.

The database had already committed to this reading. Migration
`1781100000047-LinkedPartyReadPolicies` added `apprentices_select_linked_org`,
admitting an apprentice row when an enrolment links it to the current org as
_either_ party, because "the other party to the enrolment is then locked out of
the learner's name, which is on every screen either portal shows". The row
policy has permitted this read all along. The query is what never asked for it.

`enrolments_select` (migration `1781100000015`) already admits
`employerOrganisationId = app_current_org()`, so the `EXISTS` subquery resolves
under RLS as `graddly_app`, not only for a superuser.

### The application query is deliberately narrower than the policy

The RLS policy accepts either party to the enrolment. The service admits an
employer **only where they are the employer** — matching `providerOrganisationId`
here would let an employer read a provider's entire book through their own
roster. The two are meant to agree on what is _forbidden_, not to be the same
expression, and the tighter of the two belongs in the service where the intent
is legible.

### Reads widen, writes do not

Migration 47 widened `SELECT` only, and this change must not have quietly
enabled more. `PATCH /apprentices/:id` as the employer is asserted to return
403 or 404 in the e2e spec.

---

## What was fixed — F1.2.2

Three separate faults, and repairing any one alone still failed. That is why an
earlier pass, which widened only the portal assertion, produced a 500 where the
403 had been and was correctly abandoned.

### 1. Authorisation

`assertPortalType(organisationId, PortalType.PROVIDER)` refused every employer
before this enrolment was ever considered. It is replaced by
`findReadableEnrolment`, which admits exactly two parties: the provider that
owns the enrolment (`organisationId`) and the employer named on it
(`employerOrganisationId`), as a TypeORM `where` array — an OR whose arms both
pin the id.

`providerOrganisationId` is deliberately **not** matched. It is a link column,
and the owning provider is already admitted by the first arm; adding it would
widen the route past the two parties the PRD names.

The predicate is strictly stronger than the check it replaces: holding an
employer portal was never sufficient, and the question that matters is whether
this caller is a party to _this_ enrolment. An id the caller may not read
answers 404, never 403 — a 403 confirms the id exists, which is a membership
oracle.

### 2. Scoping, which is a different question

Eight reads scoped by `user.organisationId`: the enrolment lookup itself, the
documents list, reviews, the OTJ page and its count, intervention actions, the
open break, and review signatures. Correct only while the caller is the
provider. For an admitted employer every one of them returned nothing — not a
403 the screen could report, but an empty, plausible-looking profile.

The fix is one binding, not eight. `organisationId` is now resolved once, after
the enrolment is fetched and authorised, from `enrolment.organisationId`. The
caller's organisation is never bound in that scope at all — it exists only
inside `findReadableEnrolment` — so a read added to this method later cannot
reach for the wrong one. Patching eight call sites would have left the ninth
free to reintroduce the bug.

`enrolment.employerOrganisationId` is still used where it belongs, for the
employer contact lookup: that genuinely is a question about the employer's own
records.

### 3. Row policies — migration `1781100000054`

`standards_select` and `intervention_actions_select` were owner-only, so under
`graddly_app` `enrolment.standard` came back null and the aggregate threw
`Cannot read properties of null (reading 'title')`. Both now carry an
`*_select_linked_org` policy in the shape migration 47 uses: additive,
`FOR SELECT` only, keyed through `enrolments`.

Employer-only, unlike 47's policies, which admit either party — a provider
already reads both tables through the existing owner rule, so a provider arm
here would widen nothing and only mislead the reader.

The same migration adds `IDX_enrolments_active_employer_org` on
`enrolments ("employerOrganisationId") WHERE "isDeleted" = false`.
`IDX_enrolments_org_employer_org` leads with `organisationId`, so a predicate
constraining only `employerOrganisationId` cannot seek it — every linked-party
read has been scanning `enrolments` since migration 47.

**A known property, recorded rather than fixed.** Both predicates filter
`e."isDeleted" = false` and say nothing about `e.status`. An employer whose
apprentice withdrew keeps read access for as long as the enrolment row
survives. That is already true of `apprentices_select_linked_org` and
`enrolments_select`; diverging here would leave an employer able to read the
learner's name but not their standard, which is a stranger state than either.
Whether linked-party reads should expire with the enrolment is a retention
decision, not an engineering one.

---

## The tutor's name, and the rule that came with it

F1.2.2 AC1 lists what the profile must contain: _"personal details (name,
start date, standard, provider, tutor, line manager)"_. After the three fixes
above, the employer got the profile and the tutor arrived as
`{ userId: "f2c654c8-…", name: null }` — the field the AC names, empty, with
nothing anywhere reporting an error.

`users_select` is the only SELECT policy on `users` — checked against the test
database, not only the migrations:

```
app_rls_bootstrap() OR id = app_current_user() OR app_user_in_current_org(id)
```

The tutor is a member of the **provider's** organisation, so an employer
caller matches none of the three arms and `userRepo.findOne` returned null.

### What the roster already does — the finding that decided this

The gap was believed to reach past the profile. `tutorUserDisplayName` on the
enrolment roster is built from a `usersById` map
(`enrolments.service.ts:802`), which looks like the same `users` read under
the same policy — which would mean a null tutor on every employer roster row
as well, and "No tutor assigned" on screen against apprentices who have one.

It is not the same read. `enrichEnrolmentsForDisplay` wraps its whole
hydration block in `setRlsBootstrap(true)` (`enrolments.service.ts:740`,
restored at `:821`), which satisfies the first arm of `users_select`; the GUCs
are re-sent before every statement (`postgres-query-runner.patch.ts:47`), so
the flag is live for exactly those queries. Verified end to end as
`graddly_app`, with a tutor who is a member of the provider's organisation and
of nothing else:

| Read, as the employer                      | Result                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| `GET /enrolments` → `tutorUserDisplayName` | `Rowan Tutor (rowan@…)` — identical to the provider's row |
| `GET /learners/:id/profile` → `tutor`      | `{ userId: …, name: null }`                               |

The employer was already receiving the tutor's name **and email** one endpoint
over, and the gap was confined to the profile aggregate. That settled the
choice of fix:

- A **`SECURITY DEFINER`** function returning only the display name would be a
  new mechanism disclosing strictly less than `/enrolments` already serves. It
  would guard a name that is already published.
- **Denormalising** the name onto `enrolments` adds a write path to keep in
  step with `assignTutorInBulk` and every future writer of `tutorUserId`, for
  a field the aggregate can read directly. Stale names are the failure mode,
  and they are silent.
- **Widening `users_select` row-level** was never available: the row carries
  `password` and `mfaSecret`, kept off the wire by `select: false` — an ORM
  convention guarding a database boundary, and the wrong thing to rest a
  policy decision on.

What shipped is the option the same aggregate was already using one field
away. `LearnerMetricsService.loadTutorNames` hydrates under the bootstrap flag
exactly as `loadEmployerContacts` does, and `learner-profile.service.ts`
routes the tutor through it rather than reading `users` itself.

### Bootstrap is for named, narrow reads

`setRlsBootstrap(true)` is a bypass. Its own doc comment said "public auth
routes", which stopped being the whole truth when display-name hydration
started using it, and three call sites that happen to agree are not a pattern.
So, a rule. Two kinds of read may use it:

- **a display name** — a label rendered beside a record the caller may already
  read (the tutor's name on an employer's learner profile);
- **a counterparty field** — one named field of a row belonging to the other
  party to a record the caller is party to, where that party's own table admits
  only its members (the recipient's UKPRN, which the donor must send to ESFA;
  the transfer a provider is attaching its own learner to).

Both obey the same four conditions:

1. **Named columns only.** A `select` listing exactly the fields needed —
   `loadTutorNames` takes `['id', 'firstName', 'lastName']`,
   `recipientUkprn` takes `['ukprn']`. Never a whole row, never a list,
   never a count.
2. **The narrowest window that can hold the read**: opened immediately before
   it, restored in a `finally`, never spanning unrelated work. Restore the
   _previous_ value rather than setting `false`, or a nested call switches the
   flag off under its caller.
3. **After an authorisation check, not instead of one.** Under the flag the
   ids are the whole access decision, so they must come from rows the caller
   has already read under its own policy. `submitToDas` confirms the caller is
   the transfer's donor first; the enrolment link authorises on the enrolment —
   which the caller owns, read under RLS — before it reads the transfer.
4. **Nothing a decision is taken on that the caller could not otherwise have.**
   A label, or a field the relationship entitles them to. Not a row they are
   merely curious about.

Never a whole request. `rls-bootstrap.middleware.ts` once matched every POST
under `/levy-exchange/transfers` with an unanchored `path.includes()`, which
turned the tenant boundary off on four routes to serve two reads — create,
sign, submit and enrolment links, with the service's `where` clauses the only
separation, and an e2e suite that passed a recipient's signature because of it.
That branch is gone, and its spec now fails if the bypass list grows or if any
entry stops being an anchored suffix.

A consequence of (3) worth knowing: `assignTutorInBulk` does not check that
`tutorUserId` is a member of the provider's organisation, so a provider can
write any UUID there and the hydrator will resolve that user's name. This is
not new — `/enrolments` has done it since `enrichEnrolmentsForDisplay` was
written — but it is the shape of hole the rule leaves, and validating the
assignment, not narrowing the hydrator, is where it closes.

Where this rule comes up next:
`MessageThreadsService.listSummariesForEnrolment` does a column-scoped
counterparty read (`message-threads.service.ts:139`) that is _not_ wrapped, so
a counterparty's name is null for a caller outside their organisation. Left
alone deliberately — messaging visibility is its own open question, below.

`src/learners/learner-metrics.service.spec.ts`,
`src/levy-exchange/levy-transfer.service.spec.ts` and
`src/levy-exchange/services/levy-transfer-funding.service.spec.ts` assert all
four conditions at every call site, so the rule fails a build rather than a
review.

---

## F1.2.2, criterion by criterion

The endpoints now serve the employer. **F1.2.2 is not met.** Each row below
was checked as the employer, running as `graddly_app`, against a real enrolment
with a saved review record (a temporary e2e, not committed), unless it says
otherwise. "API" and "screen" are kept apart because they fail differently:
two of these are already served and simply not shown.

| AC  | Criterion                                                                    | Status                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | personal details (name, start date, standard, provider, tutor, line manager) | **provider blank**; the rest served         | Tutor served as of this change. `providerOrganisationName` is null, and the drawer renders `"—"` (`ProfileOverview.jsx:159`). It is resolved from the link column only, which is null whenever the provider owns the enrolment (`enrolments.service.ts:565-566` defines that case). The profile DTO has no provider field. `enrolment-journey.service.ts:501` already uses `providerOrganisationId ?? organisationId`. |
| AC2 | programme timeline, enrolment to EPA, with milestone completion status       | API ✓ — **screen ✗**                        | `GET /enrolments/:id/journey` as the employer: 200, milestone statuses `complete, complete, current, upcoming ×3`, a four-item gateway checklist. The drawer builds its own timeline from the profile (`programme-milestones.js`), whose header says only reviews carry a state. `useEnrolmentJourney` (`enrolments.query.js:67`) has no caller.                                                                       |
| AC3 | OTJ hours chart, weekly, over the programme lifetime                         | **screen ✗**; data partial                  | No chart on the drawer — `ProfileActivity.jsx` lists sessions. The profile carries at most 500 entries (`learner-profile.service.ts:30`) with a `truncated` flag, so a long programme cannot be charted over its lifetime from it.                                                                                                                                                                                     |
| AC4 | review history with dates, outcomes, and action points                       | API ✓ — **screen ✗**                        | `GET /reviews/:id/record` as the employer: 200 with `progressSummary`, `actionsAgreed` and `smartGoals`. `review-records.service.ts:204` admits the linked employer, and so does `review_records_select_linked_org`. The drawer reads only `profile.reviews` — dates, status and signatures (`ProfileReviews.jsx:27-31`).                                                                                              |
| AC5 | document library: signed agreements, review records, correspondence          | **downloads ✗**; "correspondence" undefined | `pdf_generation_jobs` is owner-only — see below. There is no correspondence document type (`LearnerDocumentType`: commitment, review, evidence), and the PRD does not say what correspondence is. That is a question for the client, not a build task.                                                                                                                                                                 |
| AC6 | direct messaging thread to tutor and apprentice                              | **deliberately narrow**                     | An employer reaches a thread only as its counterparty — see below.                                                                                                                                                                                                                                                                                                                                                     |
| AC7 | loads within 2 seconds                                                       | **unpinned for the employer**               | 178 ms on a warm read against a local database — indicative only. The one budget test (`test/learners/profile.e2e-spec.ts:184`) runs as a provider, for F2.2.4 AC7.                                                                                                                                                                                                                                                    |

---

## Still narrower than the provider's view

The employer now gets the profile, and it is not quite the provider's profile.
One row policy is still narrower than the screen needs, and one behaviour is
narrower on purpose.

| Table                 | Why                                        | Effect on the employer                                                                           |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `pdf_generation_jobs` | `pdf_generation_jobs_select` is owner-only | commitment and review documents can list without a `storageKey`, so there is nothing to download |

That one is a genuine F1.2.2 AC5 gap, and the worst-shaped kind: the document
appears in the library and cannot be opened. `resolveReviewPdfKey` and
`resolveCommitmentPdfKey` read `pdf_generation_jobs` for the output key, and
that read finds nothing under an employer's organisation, so `storageKey` and
`downloadUrl` are both absent while the row itself lists.

**Message threads (AC6) are empty for employer staff who are not themselves a
participant, and that is deliberate.** `message_threads` carries two SELECT
policies — `app_rls_bootstrap() OR "organisationId" = app_current_org()`, and
`"apprenticeUserId" = app_current_user() OR "counterpartyUserId" =
app_current_user()` — and `visibleThreadWhere` mirrors the second
(`message-threads.service.ts:212`). A thread is stamped with
`enrolment.organisationId`, which is the provider's, so an employer reaches
one only as its counterparty. Whether employer staff at large should read a
learner's thread is a privacy decision rather than an engineering one;
Migration 47 records it as raised with the client in `DECISIONS-FOR-CLIENT.md` (`1781100000047-LinkedPartyReadPolicies.ts:107`). That file is not in this checkout — nor are `OPEN_QUESTIONS.md` and `PROJECT-STATUS.md`, which the code also cites — so whether the question is still open could not be checked here.

### `ks_evidence_items` stays closed, and that is the specification

An earlier revision of this note listed portfolio evidence as a third gap. It
is not one. Nothing below should be widened on the belief that an acceptance
criterion asks for it, because none does.

F1.2.2 **AC5** is the employer's document library, in full: _"all signed
agreements, review records, and correspondence"_. Portfolio evidence is not a
signed agreement, not a review record and not correspondence — it is the
apprentice's KSB portfolio (PRD §5.2.3, Portal 3).

The PRD draws the line itself, one feature over. `GET
/learners/:enrolmentId/profile` serves both learner profiles, and the two
document-library criteria are worded differently on exactly this point:

| Criterion                                | Document library contains                                     |
| ---------------------------------------- | ------------------------------------------------------------- |
| F1.2.2 AC5 — employer                    | all signed agreements, review records, and **correspondence** |
| F2.2.4 AC4 — tutor and programme manager | all signed agreements, review records, **uploaded evidence**  |

One endpoint, two features, and the difference between them is this table. An
employer whose library is narrower than the tutor's is the behaviour F1.2.2
specifies, not a leftover from this change.

So `ks_evidence_items_select` stays owner-only. If an employer is ever to see
portfolio evidence, that is a new requirement and belongs in
`DECISIONS-FOR-CLIENT.md` first — not a row policy added quietly to close a
"gap" that no criterion ever opened.

One warning for whoever reads this next. The distinction is enforced by the row
policy alone, not by the service. `learner-documents.service.ts:163` reads
accepted evidence for every caller, and since the scoping fix it asks for it
under the _provider’s_ `organisationId` — so the only thing keeping portfolio
evidence out of the employer’s library is `ks_evidence_items_select` failing to
match. Widen that policy for some unrelated reason and F1.2.2’s document
library changes behaviour with no edit to the profile code and nothing in this
suite to fail. Widen it and the employer’s document library must be filtered in
the service instead.

That coupling is now pinned by a test rather than by this paragraph.
`employer-learner-access.e2e-spec.ts` asserts both halves against the same
accepted evidence item: the provider’s library contains it, the employer’s
does not. A pair on purpose — the employer half alone passes against an empty
table and proves nothing, which is exactly how the fixture’s draft-status
evidence row would have flattered it.

## Tests

| File                                             | Covers                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/apprentices/apprentices.service.spec.ts`    | the branch itself — provider keeps ownership scoping and gains no `EXISTS`; employer gets the `EXISTS`, on `employerOrganisationId` only, with ownership _not_ ORed back in                                                                                    |
| `src/reporting/reporting-portal.service.spec.ts` | `assertPortalTypeIn` — multi-type admission, refusal, a null `portalType` refused rather than matched, and the single-type message preserved verbatim                                                                                                          |
| `src/learners/learner-profile.service.spec.ts`   | the OR predicate has two arms and no `providerOrganisationId`; every sub-read receives the enrolment owner’s id while the caller is the employer; messaging still receives the caller; the tutor name comes from the hydrator and not from a `users` read here |
| `src/learners/learner-metrics.service.spec.ts`   | the display-name rule, at both call sites: the flag is on for the read and off after it, a previously-set flag is restored rather than cleared, the `select` is exactly the display fields, and an empty id list opens no window at all                        |
| `test/employer-learner-access.e2e-spec.ts`       | end to end as `graddly_app`, every "can read" paired with a "cannot" — 14 cases, none skipped, including the tutor’s name and the absence of portfolio evidence                                                                                                |
| `test/tutor-caseload.e2e-spec.ts`                | the provider side of the same hydrator: the caseload still resolves the tutor’s name, so widening it for the employer did not move the provider’s answer                                                                                                       |

The sharpest e2e case is the near miss: a learner **at the same provider** whose
employer is somebody else. A fix that widened to "any apprentice my provider
teaches" would pass every other assertion in the file. That case is built by
writing `employerOrganisationId` directly, because there is no endpoint for
reassigning an employer mid-enrolment and the transfer flow is not what is
under test.

An empty roster is visibly broken and gets reported. One extra learner in a
list of thirty is noticed by nobody, and it is another employer's employee —
which is why the isolation half of this carries more weight than the half that
makes the screen work.
