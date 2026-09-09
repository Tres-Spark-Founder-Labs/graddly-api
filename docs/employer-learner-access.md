# Employer access to apprentices and learner profiles

> F1.2.1 is fixed. F1.2.2 is not, and this note says exactly what is left.
> Referenced from `test/employer-learner-access.e2e-spec.ts`.

---

## The defect

Two Phase 1 **Must Have** features on the employer portal failed for every
employer account, on every deployment, since the endpoints were written.

| Feature                                  | Endpoint                             | Symptom      |
| ---------------------------------------- | ------------------------------------ | ------------ |
| F1.2.1 All-Apprentice Overview Dashboard | `GET /apprentices`                   | roster empty |
| F1.2.2 Individual Learner Profile        | `GET /learners/:enrolmentId/profile` | flat 403     |

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

## What is not fixed — F1.2.2, and why it was not forced

`assertPortalTypeIn` exists on `ReportingPortalService` and is ready. The
profile endpoint still calls `assertPortalType(organisationId,
PortalType.PROVIDER)` and still answers 403 to an employer.

Widening only the assertion produces a **500 in place of the 403**, which is
worse than the bug. Three things break, in order:

1. **The enrolment lookup** (`learner-profile.service.ts:67`) matches on
   `organisationId`, which for an employer is their own org, not the
   enrolment's. Result: 404 — the fix appears to do nothing.
2. **Ten sub-reads scope by the caller's org** — documents, reviews, OTJ
   entries and count, intervention actions, break-in-learning, review
   signatures (`:87`, `:89`, `:103`, `:108`, `:122`, `:127`, `:133`). Each must
   scope by the _enrolment's owning organisation_ instead, which is the
   provider's, having first established the caller is a party to that
   enrolment.
3. **Two tables have no linked-party read policy.** `standards_select`
   (migration `1779600000000`) and `intervention_actions_select` (migration
   `1781100000009`) are both `"organisationId" = app_current_org()` and nothing
   else. Under `graddly_app`, `enrolment.standard` comes back null and the
   aggregate throws `Cannot read properties of null (reading 'title')`.

Note that (3) does not reproduce on a dev database, which connects as a
superuser for whom RLS is not enforced — the same trap migration 47 documents.
A green local run of the profile tests would not mean the endpoint works in
staging.

### The order to do it in

1. Migration: `standards_select_linked_org` and
   `intervention_actions_select_linked_org`, additive `FOR SELECT` policies in
   the shape migration 47 uses. Never drop or widen the owner rule.
2. `learner-profile.service.ts`: swap `assertPortalType` for
   `assertPortalTypeIn(organisationId, [PortalType.PROVIDER,
PortalType.EMPLOYER])`, use the returned organisation's `portalType` to pick
   the enrolment predicate, and re-scope the sub-reads to
   `enrolment.organisationId`.
3. Unskip `describe.skip('GET /learners/:enrolmentId/profile as an employer')`
   in `test/employer-learner-access.e2e-spec.ts`. All six cases are written.

### 404, never 403

An employer asking for an enrolment they cannot read gets 404. A 403 confirms
the id exists, which is a membership oracle: it lets an employer enumerate ids
and learn which belong to real enrolments at organisations they have nothing to
do with. The skipped spec asserts this explicitly.

---

## Tests

| File                                             | Covers                                                                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/apprentices/apprentices.service.spec.ts`    | the branch itself — provider keeps ownership scoping and gains no `EXISTS`; employer gets the `EXISTS`, on `employerOrganisationId` only, with ownership _not_ ORed back in |
| `src/reporting/reporting-portal.service.spec.ts` | `assertPortalTypeIn` — multi-type admission, refusal, a null `portalType` refused rather than matched, and the single-type message preserved verbatim                       |
| `test/employer-learner-access.e2e-spec.ts`       | end to end, every "can read" paired with a "cannot"                                                                                                                         |

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
