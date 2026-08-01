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
