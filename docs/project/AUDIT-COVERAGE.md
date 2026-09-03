# Audit coverage — which entities produce a trail, and which do not

76 entity classes. **41 audited, 35 not.**

Auditing happens in `AuditLogSubscriber`, gated by two hand-maintained lists in
`src/audit/audit-organisation-id.resolver.ts`:

- `isAuditedEntity` — does this entity produce a row at all?
- `resolveAuditOrganisationId` — which organisation does that row belong to?

`audit-coverage.spec.ts` now fails when those two disagree in either direction.
That test exists because four faults had accumulated unnoticed; see the bottom
of this file.

---

## The 35 unaudited classes

### Deliberate — no user action to record (13)

These record work the system did to itself. A trail would say "a queue ran",
which the queue's own state already says.

| class | why not |
| --- | --- |
| `AuditLogEntry` | Auditing the audit log recurses. Immutability is enforced by trigger instead. |
| `PdfGenerationJob` | Job state. The document it produces is audited. |
| `EpaPackJob` | Job state. |
| `EvidencePackJob` | Job state. |
| `EnrolmentSubmissionPush` | DAS delivery attempt; `das_api_activity` is the record of the call. |
| `EnrolmentCompletionPush` | As above. |
| `ReviewReminderDispatch` | Dispatch ledger, written by cron, deduplicates reminders. |
| `RetentionRunLog` | Its own audit record — a log of a retention run. |
| `DasApiActivity` | Already the API call log; auditing it duplicates itself. |
| `MessageThreadRead` | A read marker, written on every thread open. High volume, no decision. |
| `UserOidcIdentity` | Identity-provider link, managed by the OIDC flow. |
| `FlowportalRegistrationSession` | Short-lived wizard state, discarded on completion. |
| `AiProgrammeProgress` | Per-module progress ticks; the enrolment and completion are audited. |

### Probably deliberate, worth confirming (8)

| class | why not, and the doubt |
| --- | --- |
| `AiProgrammeModule` | Catalogue content, not customer data. But it is editable, and nothing records who changed a module. |
| `AiProgrammeCompletion` | Completion of an AI programme. Arguably a learner outcome and arguably a progress tick. |
| `NotificationPreference` | A user's own setting. Low stakes unless someone disables another user's alerts. |
| `Notification` | High volume, machine-generated. The action that caused it is audited at source. |
| `ProgrammeDocument` | Uploaded file metadata; the storage layer keys are recorded. |
| `IlrMappingConfig` | Versioned in its own table with `status` and `publishedAt`, so it has a history of a different shape. |
| `ReportSubscription` | Who receives a scheduled report. Changing it is a small disclosure decision. |
| `SignatureRecord` | The e-signature artefact. `commitment_signatures` and `review_signatures` are both audited, so the act of signing is covered — this is the stored image. |

### Gaps I would question (14)

These carry customer data or record decisions about a learner, and nothing
records who made them. Listed for a decision rather than fixed, as instructed.

| class | why it looks like a gap |
| --- | --- |
| **`User`** | Name, email and role changes on a person's account are not recorded anywhere. The membership is audited; the user is not. |
| **`BreakInLearning`** | A break changes funding and EPA dates. Who entered it, and when, is not recorded. |
| **`EpaOutcomeRecord`** | The assessment result. Arguably the single most consequential row for a learner. |
| **`InterventionAction`** | F2.2.2. What a tutor did about an at-risk learner, unattributed. |
| **`FundingClaimResolution`** | Money. Who resolved a claim discrepancy is not recorded. |
| **`EifScoreSnapshot`** | Ofsted evidence. Inspectors ask who produced a figure. |
| **`SarReport`** | Self-assessment report — same. |
| **`SafeguardingChecklistItem`** | Safeguarding. The one area where "who confirmed this" is the whole point. |
| **`EmployerVisit`** | F2.4.2. A visit record is evidence; unattributed evidence is weaker. |
| **`EmployerVisitLearner`** | Which learners a visit covered. |
| **`SurveyTemplate`** | F2.4.3. Who wrote the question affects how the answer reads. |
| **`SurveyCampaign`** | Who sent it and to whom. |
| **`SurveyInvitation`** | Contains a recipient token; a disclosure record. |
| **`LevyTransferEnrolment`** | Which enrolments a transfer funds. The transfer itself is audited; this join is not. |

`SafeguardingChecklistItem`, `EpaOutcomeRecord` and `User` are the three I would
raise first.

---

## The four faults this file was written after

Found by diffing the two lists against each other:

| entity | fault | effect |
| --- | --- | --- |
| `DasLevyMonthlyEntry` | in resolver, absent from `isAuditedEntity` | never audited |
| `DasFundingPayment` | same | never audited |
| `CommitmentChaseDispatch` | same | never audited |
| `Programme` | audited, no resolver branch | **worse** — the row is written with `organisationId: null`, and `audit-export.service.ts:50` filters on `audit.organisationId = :organisationId`. `NULL = uuid` is never true in SQL, so the row exists and no tenant can retrieve it. The report shows nothing happened. |

All four are fixed. `audit-coverage.spec.ts` fails if any recurs, in either
direction — verified by reintroducing one of each and watching the
corresponding assertion fail.
