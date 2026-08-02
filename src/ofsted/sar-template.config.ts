/**
 * F2.1.3 AC2 — "the standard Ofsted SAR template structure".
 *
 * **A claim worth being precise about.** Ofsted publishes no mandated SAR
 * template, and never has. Providers write their own. What the sector means
 * by "standard structure" is a self-assessment organised around the judgement
 * areas of the Education Inspection Framework, each carrying a self-assessed
 * grade, the evidence behind it, and the resulting improvement actions —
 * because that is the order an inspector reads in, and a SAR arranged any
 * other way makes them do the mapping themselves.
 *
 * So that is what this is: the EIF judgement areas, in framework order,
 * bracketed by a context section and an overall-effectiveness section, with
 * areas for improvement drawn from the QIP at the end. It is not a submission
 * to a schema, and nobody should tell the client it is.
 *
 * The seven middle sections are keyed to the **same slugs as the EIF criteria
 * catalogue**, which is what lets each section be seeded with its own live
 * score rather than a generic paragraph. Add a criterion to that catalogue
 * and it will want a section here too — `assertSectionsCoverCriteria` in the
 * spec fails if the two drift apart.
 */

/** Ofsted's four-point grading scale, used for the self-assessed grade. */
export enum SarGrade {
  OUTSTANDING = 'outstanding',
  GOOD = 'good',
  REQUIRES_IMPROVEMENT = 'requires_improvement',
  INADEQUATE = 'inadequate',
}

export const SAR_GRADE_LABELS: Readonly<Record<SarGrade, string>> =
  Object.freeze({
    [SarGrade.OUTSTANDING]: 'Outstanding (1)',
    [SarGrade.GOOD]: 'Good (2)',
    [SarGrade.REQUIRES_IMPROVEMENT]: 'Requires improvement (3)',
    [SarGrade.INADEQUATE]: 'Inadequate (4)',
  });

export type SarSectionTemplate = {
  key: string;
  heading: string;
  /** Explains to the writer what belongs here. Not printed in the export. */
  guidance: string;
  /**
   * The EIF criterion whose score seeds this section, when there is one.
   * `null` for the context, overall and improvement sections, which are
   * about the whole provider rather than one judgement area.
   */
  eifCriterionSlug: string | null;
  /** Whether the section carries a self-assessed grade. */
  graded: boolean;
};

export const SAR_SECTION_TEMPLATES: readonly SarSectionTemplate[] =
  Object.freeze([
    {
      key: 'provider_context',
      heading: 'Provider context',
      guidance:
        'Who you are, what you deliver, to whom, and anything an inspector ' +
        'needs in order to read the rest of this report fairly.',
      eifCriterionSlug: null,
      graded: false,
    },
    {
      key: 'curriculum_intent',
      heading: 'Quality of education — intent',
      guidance:
        'What you set out to teach and why, including how the curriculum is ' +
        'planned and sequenced against employer need.',
      eifCriterionSlug: 'curriculum_intent',
      graded: true,
    },
    {
      key: 'curriculum_implementation',
      heading: 'Quality of education — implementation',
      guidance:
        'How teaching, training and assessment are delivered, and how you ' +
        'know learners are building knowledge and skills over time.',
      eifCriterionSlug: 'curriculum_implementation',
      graded: true,
    },
    {
      key: 'curriculum_impact',
      heading: 'Quality of education — impact',
      guidance:
        'What learners achieve: attainment, progression, destinations, and ' +
        'end-point assessment outcomes.',
      eifCriterionSlug: 'curriculum_impact',
      graded: true,
    },
    {
      key: 'behaviour_attitudes',
      heading: 'Behaviour and attitudes',
      guidance:
        'Attendance, commitment to off-the-job learning, conduct in the ' +
        'workplace, and how you respond when any of it slips.',
      eifCriterionSlug: 'behaviour_attitudes',
      graded: true,
    },
    {
      key: 'personal_development',
      heading: 'Personal development',
      guidance:
        'Wider development beyond the standard: British values, careers ' +
        'guidance, health and wellbeing, and preparation for working life.',
      eifCriterionSlug: 'personal_development',
      graded: true,
    },
    {
      key: 'leadership_management',
      heading: 'Leadership and management',
      guidance:
        'Governance, staff development, the accuracy of this ' +
        'self-assessment, and how leaders act on what it finds.',
      eifCriterionSlug: 'leadership_management',
      graded: true,
    },
    {
      key: 'safeguarding',
      heading: 'Safeguarding',
      guidance:
        'Arrangements, culture, single central record, Prevent duty, and ' +
        'how concerns are raised and acted on.',
      eifCriterionSlug: 'safeguarding',
      graded: true,
    },
    {
      key: 'overall_effectiveness',
      heading: 'Overall effectiveness',
      guidance:
        'Your overall self-assessed judgement, and the reasoning that gets ' +
        'you there from the sections above.',
      eifCriterionSlug: null,
      graded: true,
    },
    {
      key: 'areas_for_improvement',
      heading: 'Areas for improvement',
      guidance:
        'What you are doing about the weaknesses identified above. Seeded ' +
        'from the Quality Improvement Plan.',
      eifCriterionSlug: null,
      graded: false,
    },
  ]);

export function getSarSectionKeys(): string[] {
  return SAR_SECTION_TEMPLATES.map((s) => s.key);
}

export function findSarSectionTemplate(
  key: string,
): SarSectionTemplate | undefined {
  return SAR_SECTION_TEMPLATES.find((s) => s.key === key);
}
