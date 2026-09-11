# Employer access to apprentices and learner profiles

> F1.2.1 and F1.2.2 are both fixed. What remains is listed under "Still
> narrower than the provider's view" — read that before assuming the employer
> profile is complete.
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

## Still narrower than the provider's view

The employer now gets the profile, and it is not yet the same profile. Three
things are missing, all of them row policies, none widened here because the
scope of this change was the two parties on the enrolment.

| Table                 | Why                                                                                                             | Effect on the employer                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `users`               | `users_select` admits `app_user_in_current_org(id)`, and the tutor is a member of the _provider's_ organisation | `tutor.name` is null — and F1.2.2 AC1 names the tutor as a required personal detail              |
| `ks_evidence_items`   | `ks_evidence_items_select` is owner-only                                                                        | accepted portfolio evidence is absent from the document library                                  |
| `pdf_generation_jobs` | `pdf_generation_jobs_select` is owner-only                                                                      | commitment and review documents can list without a `storageKey`, so there is nothing to download |

Message threads are also empty for employer staff, and that one is deliberate:
`message_threads_select_participant` scopes to the two participants rather than
to an organisation, which migration 47 explains and `DECISIONS-FOR-CLIENT.md`
carries as an open privacy question.

## Tests

| File                                             | Covers                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/apprentices/apprentices.service.spec.ts`    | the branch itself — provider keeps ownership scoping and gains no `EXISTS`; employer gets the `EXISTS`, on `employerOrganisationId` only, with ownership _not_ ORed back in           |
| `src/reporting/reporting-portal.service.spec.ts` | `assertPortalTypeIn` — multi-type admission, refusal, a null `portalType` refused rather than matched, and the single-type message preserved verbatim                                 |
| `src/learners/learner-profile.service.spec.ts`   | the OR predicate has two arms and no `providerOrganisationId`; every sub-read receives the enrolment owner's id while the caller is the employer; messaging still receives the caller |
| `test/employer-learner-access.e2e-spec.ts`       | end to end, every "can read" paired with a "cannot" — 11 cases, none skipped                                                                                                          |

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
