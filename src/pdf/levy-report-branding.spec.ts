import { PdfKitPdfRenderer } from './providers/pdfkit-pdf.renderer.js';

import type { ILevyRoiReportContent } from './interfaces/pdf-renderer.interface.js';

/**
 * F1.1.5 — the exported levy report must carry the required sections and the
 * employer's branding, and must never fail because of a bad logo.
 *
 * Note on approach: PDFKit compresses content streams, so the drawn text is
 * not greppable in the output buffer and asserting on it would require a PDF
 * parser. These tests therefore assert *structurally* — that rendering
 * succeeds, that optional sections change the output when present, and that
 * hostile inputs degrade instead of throwing. Whether a section is drawn is
 * inferred from output size, which is indirect but real: a section that is
 * skipped cannot make the document bigger.
 */
const baseContent: ILevyRoiReportContent = {
  organisationName: 'Midlands Engineering Ltd',
  logoUrl: null,
  logoBytes: null,
  summary: {
    totalLevySpendToDate: 120000,
    availableBalance: 80000,
    currency: 'GBP',
    utilisationPercent: 60,
    activeApprenticeCount: 12,
    completionCount: 4,
    averageCostPerCompletion: 18500,
    epaPassRate: null,
    estimatedProductivityUplift: 25000,
    monthlyContributions: [{ month: '2026-01', amount: 15000 }],
    utilisationSegments: {
      used: 120000,
      expiringWithin90Days: 45000,
      available: 80000,
      currency: 'GBP',
    },
  },
  forecast: {
    horizonMonths: 12,
    activeEnrolmentCount: 12,
    projectedMonthlySpend: 1000,
    projectedCompletionLiability: 20000,
    estimatedRunwayMonths: 8,
  },
  breakdownByProvider: [],
  breakdownByStandard: [],
  generatedAt: '2026-07-30T00:00:00.000Z',
};

const render = (overrides: Partial<ILevyRoiReportContent> = {}) =>
  new PdfKitPdfRenderer().renderLevyRoiReport({ ...baseContent, ...overrides });

describe('Levy report PDF — F1.1.5', () => {
  it('produces a valid, non-trivial PDF', async () => {
    const buffer = await render();
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  describe('AC1 — forecast section', () => {
    it('renders more content when a forecast is present', async () => {
      // The forecast previously never reached the PDF at all. If the section
      // were skipped, the two documents would be identical in size.
      const withForecast = await render();
      const withoutForecast = await render({ forecast: null });
      expect(withForecast.byteLength).toBeGreaterThan(
        withoutForecast.byteLength,
      );
    });

    it('renders without a forecast rather than failing', async () => {
      // Omitting the section is correct when there is nothing to project;
      // printing zeros would read as a real forecast of no spend.
      await expect(render({ forecast: null })).resolves.toBeInstanceOf(Buffer);
    });

    it('handles a null runway without throwing', async () => {
      await expect(
        render({
          forecast: { ...baseContent.forecast!, estimatedRunwayMonths: null },
        }),
      ).resolves.toBeInstanceOf(Buffer);
    });
  });

  describe('AC1 — other required sections', () => {
    it('renders with no utilisation segments available', async () => {
      await expect(
        render({
          summary: { ...baseContent.summary, utilisationSegments: null },
        }),
      ).resolves.toBeInstanceOf(Buffer);
    });

    it('renders with no contribution history', async () => {
      await expect(
        render({
          summary: { ...baseContent.summary, monthlyContributions: [] },
        }),
      ).resolves.toBeInstanceOf(Buffer);
    });

    it('renders with a null available balance', async () => {
      await expect(
        render({
          summary: { ...baseContent.summary, availableBalance: null },
        }),
      ).resolves.toBeInstanceOf(Buffer);
    });
  });

  describe('AC2 — branding', () => {
    it('renders a larger document when a logo is embedded', async () => {
      // A 1x1 PNG, the smallest valid image PDFKit will accept.
      const pngBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      const withLogo = await render({ logoBytes: pngBytes });
      const withoutLogo = await render({ logoBytes: null });
      expect(withLogo.byteLength).toBeGreaterThan(withoutLogo.byteLength);
    });

    it('renders without a logo when the employer has none', async () => {
      await expect(render({ logoBytes: null })).resolves.toBeInstanceOf(Buffer);
    });

    it('degrades to no logo when the bytes are not a valid image', async () => {
      // A branded report is desirable; a failed report is not. PDFKit throws
      // on unparseable image data, so the renderer catches it.
      const notAnImage = Buffer.from('this is definitely not a PNG', 'utf8');
      await expect(render({ logoBytes: notAnImage })).resolves.toBeInstanceOf(
        Buffer,
      );
    });

    it('renders when the organisation name is empty', async () => {
      await expect(render({ organisationName: '' })).resolves.toBeInstanceOf(
        Buffer,
      );
    });
  });
});
