# ILR field gap — what the v1 mapping omits

What it would take for the ILR file (5.4) and the submit path (F2.3.2) to carry
a return ESFA accepts, for an **apprenticeship standard learner funded under
funding model 36** — the only kind of learner this platform holds.

> **Source and confidence.** The field list is the ESFA ILR specification's
> structure for FM36 learners as the team understands it. The ILR changes
> every academic year: before this is used to size or plan work, check it
> against the published **2025 to 2026 ILR specification, validation rules and
> XSD**. Nothing here was checked against those documents.

## What v1 carries today

`src/ilr/config/seeds/ilr-mapping-2025-26.v1.json`: nine fields and two rules.

| Field                               | Source                                            | Status                                                                                              |
| ----------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Learner.LearnRefNumber`            | enrolment id, dashes removed, first 12 characters | OK                                                                                                  |
| `Learner.FamilyName`                | apprentice                                        | OK                                                                                                  |
| `Learner.GivenNames`                | apprentice                                        | OK                                                                                                  |
| `Learner.ULN`                       | manual override only                              | Needs a source (see below)                                                                          |
| `LearningDelivery.LearnAimRef`      | constant `ZPROG001`                               | OK (corrected from `standard.code`). The standard's identity goes in `StdCode`, not mapped (below). |
| `LearningDelivery.LearnStartDate`   | enrolment planned start, `ilrDate`                | OK (corrected: `ilrDate` wrote `20250115`; it now writes `2025-01-15`, the `xs:date` pattern)       |
| `LearningDelivery.LearnPlanEndDate` | enrolment planned end, `ilrDate`                  | OK, as above                                                                                        |
| `LearningDelivery.ProgType`         | constant `25`                                     | OK                                                                                                  |
| `Provider.UKPRN`                    | organisation                                      | OK                                                                                                  |

Rules: `ILR001` checks that the UKPRN is present, and `ILR002` checks that the
start date is not after the planned end. ESFA publishes several hundred rules.

## What is missing

Each field is marked by what closing it takes:

- **derivable**: the platform already holds the data. It needs mapping only.
- **capture**: the platform does not hold it, so there has to be a way to
  collect it (apprentice onboarding or a provider form). Some of it is
  special-category personal data.
- **reference**: it needs an external register (LARS, the EPAO register).
- **structure**: the mapping format cannot express it today.

### Learner

| Field(s)                                                                                                                       | Kind               | Note                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `ULN`                                                                                                                          | capture            | 10 digits, from the Learner Registration Service. Manual today.                                                             |
| `DateOfBirth`                                                                                                                  | derivable, partly  | `users.dateOfBirth` exists but is optional and self-entered. It needs to be required for apprentices.                       |
| `Sex`                                                                                                                          | capture            | ILR takes legal sex (F/M). `users.gender` has non-binary and prefer-not-to-say, which do not map.                           |
| `Ethnicity`                                                                                                                    | capture            | Special-category data.                                                                                                      |
| `LLDDHealthProb`, plus `LLDDandHealthProblem` entities                                                                         | capture, structure | Special-category data. Repeatable entity with a primary flag.                                                               |
| `NINumber`                                                                                                                     | capture            |                                                                                                                             |
| `PriorAttain` (level and date applies)                                                                                         | capture, structure | Its own entity.                                                                                                             |
| `PostcodePrior`, `Postcode` (and address lines)                                                                                | capture            | Learner's home postcode. Only organisation postcodes are held.                                                              |
| `MathGrade`, `EngGrade`                                                                                                        | capture            | GCSE maths and English prior attainment, where applicable.                                                                  |
| `LearnerFAM` (e.g. `LSR`, `EHC`, `MCF`, `ECF`)                                                                                 | capture, structure | Repeatable. Most are conditional.                                                                                           |
| `ContactPreference`, `TelNo`, `Email`                                                                                          | derivable, partly  | Email is held. The preferences are not.                                                                                     |
| `PrevLearnRefNumber`, `PrevUKPRN`, `PMUKPRN`                                                                                   | capture            | Only for learners who moved between providers or reference numbers.                                                         |
| `LearnerEmploymentStatus` (`EmpStat`, `DateEmpStatApp`, `EmpId`, and `EmploymentStatusMonitoring` such as `SEI`, `EII`, `LOE`) | capture, structure | Required for apprentices. `EmpId` is the employer's ERN, which is not held on employer organisations. Repeatable over time. |

### LearningDelivery (one per aim)

There is at least one programme aim, plus component aims such as functional
skills maths and English where the learner takes them.

| Field(s)                                                                                | Kind                         | Note                                                                                       |
| --------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| Several learning deliveries per learner                                                 | structure                    | v1 has exactly one `LearningDelivery` per record.                                          |
| `LearnAimRef` for component aims                                                        | reference                    | The programme aim (`ZPROG001`) is mapped. Component aims need LARS references.             |
| `AimType`, `AimSeqNumber`                                                               | derivable                    | Generated from the aims.                                                                   |
| `FundModel` = `36`                                                                      | derivable                    | Constant.                                                                                  |
| `StdCode`                                                                               | reference                    | The LARS numeric standard code, not the IfATE reference (`ST0116`) held on standards.      |
| `PHours` (planned off-the-job hours)                                                    | derivable                    | The OTJ target the pace calculation uses.                                                  |
| `OTJActHours`                                                                           | derivable                    | Approved OTJ minutes, at completion or withdrawal.                                         |
| `DelLocPostCode`                                                                        | capture                      | Delivery location.                                                                         |
| `EPAOrgID`                                                                              | reference                    | ESFA EPAO ID (`EPA0001` form). Enrolments hold an EPAO name and UKPRN, not this ID.        |
| `CompStatus`, `LearnActEndDate`, `WithdrawReason`                                       | derivable, partly            | Completion and cancellation dates exist. The ESFA withdrawal reason code does not.         |
| `Outcome`, `AchDate`, `OutGrade`                                                        | derivable                    | From `epa_outcomes` (pass, merit, distinction, fail; assessed on).                         |
| `PriorLearnFundAdj`, `OtherFundAdj`                                                     | capture                      | Recognition of prior learning.                                                             |
| `OrigLearnStartDate`                                                                    | derivable, partly            | Restarts after a break. Breaks are recorded, restarts are not.                             |
| `PartnerUKPRN`                                                                          | capture                      | Subcontracted delivery only.                                                               |
| `LearningDeliveryFAM` (`ACT` contract type with dates, `SOF`, `LDM`, `RES`, and others) | capture, structure           | `ACT` (levy / non-levy) is mandatory and date-ranged. Repeatable.                          |
| `AppFinRecord` (`TNP1` training price, `TNP2` EPA price, `PMR` employer payments)       | derivable, partly; structure | `agreedPrice` is one number. ILR splits it into training and EPA price. Repeatable, dated. |

### File and message

| Item                               | Note                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSD validation                     | The file is not validated against ESFA's XSD before it is offered. It should be, in CI and at generation.                                                                                             |
| Header `SerialNo`                  | **Always `01`** (`toIlrReturnXml`, `ilrReturnFilename`). ESFA expects it to increase across submissions of the same return in a collection year. Recorded here, not fixed: it belongs with this work. |
| `LearnerDestinationandProgression` | A top-level entity for destination outcomes. Not produced.                                                                                                                                            |
| Annual specification               | Each academic year's specification needs a new mapping config version within 30 days of publication (§8.2).                                                                                           |

## What completing it involves, roughly

1. **Structure.** Extend the mapping format and the serializer to express
   repeated and nested entities: several learning deliveries, FAMs, finance
   records and employment status. This changes `IlrFieldMap`, the row builder,
   validation and both XML writers.
2. **Data capture.** Collect the learner personal and equality data above
   (DOB made mandatory, legal sex, ethnicity, LLDD, NI number, home postcode,
   prior attainment) and the employer ERN. This means a form in apprentice
   onboarding or the provider's learner record, and a GDPR review for the
   special-category fields.
3. **Reference data.** LARS for `StdCode` and component aim references, and
   the EPAO register for `EPAOrgID`, kept current.
4. **Derivations.** Planned and actual OTJ hours, completion, withdrawal and
   outcome codes, and the TNP1/TNP2 split of the agreed price.
5. **Validation.** Load ESFA's published rules, or at least the rules for the
   fields produced, and validate the file against the XSD.
6. **Fixes to v1.** The serial number. (`LearnAimRef` = `ZPROG001` and the
   date format are corrected.)

Items 1, 2 and 5 are each substantial on their own. Together they are what
separates the current file (a demonstrator of the pipeline) from a return ESFA
accepts.

The decision to take is whether F2.3.2 ships in Phase 1 with this gap declared
(D-03) or moves to Phase 2.
