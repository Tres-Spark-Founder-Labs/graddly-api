import { PdfKitPdfRenderer } from './providers/pdfkit-pdf.renderer.js';

describe('PdfKitPdfRenderer', () => {
  const renderer = new PdfKitPdfRenderer();

  it('renderHelloPdf returns a PDF buffer', async () => {
    const buffer = await renderer.renderHelloPdf();
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  /**
   * F1.3.3 AC3. The empty case is the one worth pinning: a statement with no
   * recorded activity must still produce a document that says so, rather than
   * failing and leaving the requester with a job stuck at "failed".
   */
  it('renderCommitmentAuditTrail returns a PDF buffer', async () => {
    const buffer = await renderer.renderCommitmentAuditTrail({
      organisationName: 'Midlands Engineering Ltd',
      statementId: 'stmt-1',
      currentVersion: 2,
      status: 'signed',
      apprenticeName: 'Amara Diallo',
      employerName: 'Midlands Engineering Ltd',
      providerName: 'Skillsmith Training',
      versions: [
        {
          version: 1,
          statementId: 'stmt-0',
          status: 'superseded',
          createdAt: '2026-01-01T09:00:00.000Z',
          supersededAt: '2026-03-01T09:00:00.000Z',
        },
      ],
      entries: [
        {
          at: '2026-03-01T09:00:00.000Z',
          actorName: 'Priya Shah',
          actorRole: 'admin',
          action: 'sign',
          description: 'Signed commitment statement — version 2',
          changeSummary: 'status: awaiting_signatures → signed',
        },
      ],
      entryCount: 1,
      rangeFrom: null,
      rangeTo: null,
      generatedAt: '2026-04-01T09:00:00.000Z',
      generatedByName: 'Ada Lovelace',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renderCommitmentAuditTrail renders a statement with no entries', async () => {
    const buffer = await renderer.renderCommitmentAuditTrail({
      organisationName: 'Midlands Engineering Ltd',
      statementId: 'stmt-1',
      currentVersion: 1,
      status: 'draft',
      apprenticeName: 'Amara Diallo',
      employerName: null,
      providerName: null,
      versions: [],
      entries: [],
      entryCount: 0,
      rangeFrom: null,
      rangeTo: null,
      generatedAt: '2026-04-01T09:00:00.000Z',
      generatedByName: 'Not recorded',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  /** F1.4.2 AC3 — the standalone comparison document. */
  it('renderProviderComparison returns a PDF buffer', async () => {
    const buffer = await renderer.renderProviderComparison({
      organisationName: 'Midlands Engineering Ltd',
      rows: [
        {
          label: 'Northstar Training',
          activeApprenticeCount: 4,
          completionCount: 2,
          averageOtjPercent: 72.5,
          reviewComplianceRate: 88,
          epaPassRate: 92.3,
          epaAssessedCount: 13,
          withdrawalRate: 4.5,
        },
        {
          // A provider with nothing measurable yet must still appear.
          label: 'Skillsmith',
          activeApprenticeCount: 1,
          completionCount: 0,
          averageOtjPercent: null,
          reviewComplianceRate: null,
          epaPassRate: null,
          epaAssessedCount: 0,
          withdrawalRate: null,
        },
      ],
      generatedAt: '2026-08-01T09:00:00.000Z',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renderProviderComparison handles an employer with no providers', async () => {
    const buffer = await renderer.renderProviderComparison({
      organisationName: 'Midlands Engineering Ltd',
      rows: [],
      generatedAt: '2026-08-01T09:00:00.000Z',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  /** Enough rows to cross a page boundary, exercising the paging branch. */
  it('renderProviderComparison pages a long comparison', async () => {
    const buffer = await renderer.renderProviderComparison({
      organisationName: 'Midlands Engineering Ltd',
      rows: Array.from({ length: 60 }, (_, i) => ({
        label: `Provider ${i + 1}`,
        activeApprenticeCount: i,
        completionCount: i,
        averageOtjPercent: 50,
        reviewComplianceRate: 50,
        epaPassRate: 50,
        epaAssessedCount: i,
        withdrawalRate: 5,
      })),
      generatedAt: '2026-08-01T09:00:00.000Z',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  /** F2.1.2 AC5 — the Quality Improvement Plan as an inspection document. */
  it('renderQipPlan returns a PDF buffer', async () => {
    const buffer = await renderer.renderQipPlan({
      organisationName: 'Northstar Training',
      total: 2,
      completed: 1,
      overdue: 1,
      percentComplete: 50,
      groups: [
        {
          slug: 'safeguarding',
          label: 'Safeguarding',
          actions: [
            {
              title: 'Monthly safeguarding audit',
              description: 'Audit every learner file',
              ownerName: 'Priya Shah',
              targetCompletionDate: '2026-12-31',
              status: 'In progress',
              isOverdue: true,
              evidenceNotes: 'First audit complete',
              evidenceAttachmentCount: 2,
            },
          ],
        },
      ],
      generatedAt: '2026-08-01T09:00:00.000Z',
      generatedByName: 'Ada Lovelace',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  /** A provider with no plan yet still has to be able to produce the file. */
  it('renderQipPlan handles an empty plan', async () => {
    const buffer = await renderer.renderQipPlan({
      organisationName: 'Northstar Training',
      total: 0,
      completed: 0,
      overdue: 0,
      percentComplete: 0,
      groups: [],
      generatedAt: '2026-08-01T09:00:00.000Z',
      generatedByName: 'Ada Lovelace',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  /** Enough actions to cross a page boundary, exercising the paging branch. */
  it('renderQipPlan pages a long plan', async () => {
    const buffer = await renderer.renderQipPlan({
      organisationName: 'Northstar Training',
      total: 40,
      completed: 0,
      overdue: 0,
      percentComplete: 0,
      groups: [
        {
          slug: 'safeguarding',
          label: 'Safeguarding',
          actions: Array.from({ length: 40 }, (_, i) => ({
            title: `Action ${i + 1}`,
            description: 'A description long enough to take a line or two.',
            ownerName: 'Priya Shah',
            targetCompletionDate: '2026-12-31',
            status: 'Not started',
            isOverdue: false,
            evidenceNotes: null,
            evidenceAttachmentCount: 0,
          })),
        },
      ],
      generatedAt: '2026-08-01T09:00:00.000Z',
      generatedByName: 'Ada Lovelace',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  /** F2.2.1 AC5 — the cohort table as a PDF. */
  it('renderLearnerCohort returns a PDF buffer', async () => {
    const buffer = await renderer.renderLearnerCohort({
      organisationName: 'Northstar Training',
      filterSummary: 'status At Risk, EPA in 2026-09',
      totalCount: 1,
      statusCounts: [{ label: 'At Risk', count: 1 }],
      rows: [
        {
          learnerName: 'Amara Diallo',
          employerName: 'Midlands Engineering Ltd',
          standardTitle: 'Engineering Technician',
          startDate: '2025-09-01',
          otjPercent: 62,
          nextReviewDate: '2026-09-15',
          epaDate: '2026-12-01',
          statusLabel: 'At Risk',
          tutorName: 'Priya Shah',
        },
      ],
      generatedAt: '2026-08-01T09:00:00.000Z',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  /**
   * Every nullable column at once. "—" rather than 0 or a blank: an
   * apprentice with no logged hours has not achieved 0% off-the-job, and a
   * blank cell reads as a rendering bug.
   */
  it('renderLearnerCohort handles a row with nothing recorded', async () => {
    const buffer = await renderer.renderLearnerCohort({
      organisationName: 'Northstar Training',
      filterSummary: null,
      totalCount: 1,
      statusCounts: [],
      rows: [
        {
          learnerName: 'New Starter',
          employerName: null,
          standardTitle: 'Engineering Technician',
          startDate: null,
          otjPercent: null,
          nextReviewDate: null,
          epaDate: null,
          statusLabel: 'On Track',
          tutorName: null,
        },
      ],
      generatedAt: '2026-08-01T09:00:00.000Z',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renderLearnerCohort handles an empty cohort', async () => {
    const buffer = await renderer.renderLearnerCohort({
      organisationName: 'Northstar Training',
      filterSummary: 'status Withdrawn',
      totalCount: 0,
      statusCounts: [],
      rows: [],
      generatedAt: '2026-08-01T09:00:00.000Z',
    });
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  /**
   * F2.2.1 AC4 — "table loads within 2 seconds for up to 1,000 learner
   * records". This pins the rendering half of that budget: a thousand rows
   * across ~40 landscape pages, each repeating the header.
   *
   * It does not measure the query or the network, which are the other two
   * thirds and depend on the client's environment — but a renderer that goes
   * quadratic on row count would fail here rather than in front of a provider.
   */
  it('renders a 1,000-learner cohort well inside the AC4 budget', async () => {
    const startedAt = Date.now();
    const buffer = await renderer.renderLearnerCohort({
      organisationName: 'Northstar Training',
      filterSummary: null,
      totalCount: 1000,
      statusCounts: [
        { label: 'On Track', count: 820 },
        { label: 'At Risk', count: 180 },
      ],
      rows: Array.from({ length: 1000 }, (_, i) => ({
        learnerName: `Learner Number ${i + 1}`,
        employerName: `Employer ${i % 40}`,
        standardTitle: 'Engineering Technician Level 3',
        startDate: '2025-09-01',
        otjPercent: i % 101,
        nextReviewDate: '2026-09-15',
        epaDate: '2026-12-01',
        statusLabel: i % 5 === 0 ? 'At Risk' : 'On Track',
        tutorName: `Tutor ${i % 12}`,
      })),
      generatedAt: '2026-08-01T09:00:00.000Z',
    });
    const elapsed = Date.now() - startedAt;

    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(elapsed).toBeLessThan(2000);
  }, 30000);

  it('embedSignature returns a PDF buffer without a valid PNG', async () => {
    const unsigned = await renderer.renderHelloPdf();
    const signed = await renderer.embedSignature(
      unsigned,
      Buffer.from('not-a-png'),
      {
        signedAt: new Date('2026-01-01T00:00:00.000Z'),
        signerLabel: 'signer@example.com',
      },
    );
    expect(signed.subarray(0, 4).toString()).toBe('%PDF');
  });
});
