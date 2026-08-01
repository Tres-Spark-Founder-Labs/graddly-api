import { Inject, Injectable } from '@nestjs/common';

import { PDF_RENDERER } from './pdf.constants.js';

import type {
  ICommitmentAuditTrailContent,
  ICommitmentSnapshotContent,
  ILevyRoiReportContent,
  ILevyTransferAgreementContent,
  IPdfRenderer,
  IProviderComparisonContent,
  IReviewSnapshotContent,
  ISignedPdfOptions,
} from './interfaces/pdf-renderer.interface.js';

@Injectable()
export class PdfService {
  constructor(@Inject(PDF_RENDERER) private readonly renderer: IPdfRenderer) {}

  renderHelloPdf(): Promise<Buffer> {
    return this.renderer.renderHelloPdf();
  }

  renderReviewSnapshot(content: IReviewSnapshotContent): Promise<Buffer> {
    return this.renderer.renderReviewSnapshot(content);
  }

  renderCommitmentSnapshot(
    content: ICommitmentSnapshotContent,
  ): Promise<Buffer> {
    return this.renderer.renderCommitmentSnapshot(content);
  }

  renderLevyTransferAgreement(
    content: ILevyTransferAgreementContent,
  ): Promise<Buffer> {
    return this.renderer.renderLevyTransferAgreement(content);
  }

  renderLevyRoiReport(content: ILevyRoiReportContent): Promise<Buffer> {
    return this.renderer.renderLevyRoiReport(content);
  }

  renderCommitmentAuditTrail(
    content: ICommitmentAuditTrailContent,
  ): Promise<Buffer> {
    return this.renderer.renderCommitmentAuditTrail(content);
  }

  renderProviderComparison(
    content: IProviderComparisonContent,
  ): Promise<Buffer> {
    return this.renderer.renderProviderComparison(content);
  }

  embedSignature(
    unsignedPdf: Buffer,
    signaturePng: Buffer,
    options: ISignedPdfOptions,
  ): Promise<Buffer> {
    return this.renderer.embedSignature(unsignedPdf, signaturePng, options);
  }
}
