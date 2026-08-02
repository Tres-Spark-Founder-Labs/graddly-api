import type { PdfJobTemplate } from './enums/pdf-job-template.enum.js';

export interface IPdfJobPayload {
  jobId: string;
  organisationId: string;
  userId: string;
  template: PdfJobTemplate;
  reviewId?: string;
  statementId?: string;
  transferId?: string;
  /**
   * F2.2.1 AC5 — the cohort filters, carried to the worker so the exported
   * PDF is the table the provider was looking at rather than every learner
   * they have. Loosely typed here to keep `PdfModule` free of a dependency on
   * `LearnersModule`; the processor casts it back.
   */
  cohortQuery?: Record<string, unknown>;
}
