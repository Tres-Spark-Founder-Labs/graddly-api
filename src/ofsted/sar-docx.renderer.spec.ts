import { getEifCriterionSlugs } from './eif-criteria.config.js';
import { SarReportStatus } from './enums/sar-report-status.enum.js';
import { SarDocxRenderer } from './sar-docx.renderer.js';
import { SAR_SECTION_TEMPLATES, SarGrade } from './sar-template.config.js';

import type { SarMetrics } from './entities/sar-report.entity.js';

const metrics: SarMetrics = {
  eifOverallPercent: 72,
  eifCriteria: [
    { slug: 'safeguarding', label: 'Safeguarding', percent: 90, rag: 'green' },
  ],
  qip: { total: 4, completed: 2, overdue: 1, percentComplete: 50 },
  outcomes: {
    activeCount: 12,
    completedCount: 5,
    withdrawnCount: 1,
    epaPassRate: 80,
    epaAssessedCount: 5,
  },
  reviewComplianceRate: 88,
  withdrawalRate: 4.5,
  generatedByName: 'Ada Lovelace',
  lockedByName: null,
  organisationName: 'Northstar Training',
  capturedAt: '2026-08-01T09:00:00.000Z',
};

describe('SarDocxRenderer', () => {
  const renderer = new SarDocxRenderer();

  /**
   * `.docx` is a zip; every one starts `PK`. This is the equivalent of the
   * `%PDF` check the PDF renderer specs make — it proves a real Word file
   * came out rather than something merely named `.docx`, which is exactly
   * how AC3 would be quietly failed.
   */
  it('renders a real docx (zip) container', async () => {
    const buffer = await renderer.render({
      organisationName: 'Northstar Training',
      academicYear: '2025-26',
      status: SarReportStatus.DRAFT,
      lockedAt: null,
      sections: [
        {
          key: 'safeguarding',
          heading: 'Safeguarding',
          narrative: 'Arrangements are effective.',
          grade: SarGrade.GOOD,
        },
      ],
      metrics,
    });

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('renders a locked report', async () => {
    const buffer = await renderer.render({
      organisationName: 'Northstar Training',
      academicYear: '2025-26',
      status: SarReportStatus.LOCKED,
      lockedAt: '2026-08-01T09:00:00.000Z',
      sections: [],
      metrics: { ...metrics, lockedByName: 'Priya Shah' },
    });

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  /** A brand-new provider must still be able to produce the document. */
  it('renders when every metric is null or empty', async () => {
    const buffer = await renderer.render({
      organisationName: 'Northstar Training',
      academicYear: '2025-26',
      status: SarReportStatus.DRAFT,
      lockedAt: null,
      sections: [],
      metrics: {
        eifOverallPercent: null,
        eifCriteria: [],
        qip: { total: 0, completed: 0, overdue: 0, percentComplete: 0 },
        outcomes: {
          activeCount: 0,
          completedCount: 0,
          withdrawnCount: 0,
          epaPassRate: null,
          epaAssessedCount: 0,
        },
        reviewComplianceRate: null,
        withdrawalRate: null,
        generatedByName: null,
        lockedByName: null,
        organisationName: 'Northstar Training',
        capturedAt: '2026-08-01T09:00:00.000Z',
      },
    });

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('renders multi-paragraph narratives', async () => {
    const buffer = await renderer.render({
      organisationName: 'Northstar Training',
      academicYear: '2025-26',
      status: SarReportStatus.DRAFT,
      lockedAt: null,
      sections: [
        {
          key: 'areas_for_improvement',
          heading: 'Areas for improvement',
          narrative: 'Line one\n\nLine two\n- bullet',
          grade: null,
        },
      ],
      metrics,
    });

    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });
});

describe('SAR template', () => {
  /**
   * The seven middle sections are keyed to the EIF criteria catalogue so each
   * one can be seeded with its own live score. Add a criterion without adding
   * a section and it silently gets no section; add a section pointing at a
   * criterion that does not exist and it silently gets no score. Neither
   * failure is visible at runtime, so it is pinned here.
   */
  it('stays in step with the EIF criteria catalogue', () => {
    const criterionSlugs = getEifCriterionSlugs().sort();
    const sectionSlugs = SAR_SECTION_TEMPLATES.map((s) => s.eifCriterionSlug)
      .filter((slug): slug is string => slug !== null)
      .sort();

    expect(sectionSlugs).toEqual(criterionSlugs);
  });

  it('has unique section keys', () => {
    const keys = SAR_SECTION_TEMPLATES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('grades every judgement area plus overall effectiveness', () => {
    const graded = SAR_SECTION_TEMPLATES.filter((s) => s.graded).map(
      (s) => s.key,
    );
    expect(graded).toContain('overall_effectiveness');
    expect(graded).not.toContain('provider_context');
  });
});
