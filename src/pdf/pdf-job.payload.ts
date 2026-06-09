import type { PdfJobTemplate } from './enums/pdf-job-template.enum.js';

export interface IPdfJobPayload {
  jobId: string;
  organisationId: string;
  userId: string;
  template: PdfJobTemplate;
  reviewId?: string;
  statementId?: string;
  transferId?: string;
}
