import { Injectable } from '@nestjs/common';

import type {
  ICommitmentAuditTrailContent,
  ICommitmentSnapshotContent,
  ILevyRoiReportContent,
  ILevyTransferAgreementContent,
  IPdfRenderer,
  IProviderComparisonContent,
  ILearnerCohortContent,
  IQipPlanContent,
  IReviewSnapshotContent,
  ISignedPdfOptions,
} from '../interfaces/pdf-renderer.interface.js';

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
);

@Injectable()
export class NoopPdfRenderer implements IPdfRenderer {
  renderHelloPdf(): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }

  renderReviewSnapshot(_content: IReviewSnapshotContent): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }

  renderCommitmentSnapshot(
    _content: ICommitmentSnapshotContent,
  ): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }

  renderLevyTransferAgreement(
    _content: ILevyTransferAgreementContent,
  ): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }

  renderLevyRoiReport(_content: ILevyRoiReportContent): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }

  renderCommitmentAuditTrail(
    _content: ICommitmentAuditTrailContent,
  ): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }

  renderProviderComparison(
    _content: IProviderComparisonContent,
  ): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }

  renderQipPlan(_content: IQipPlanContent): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }

  renderLearnerCohort(_content: ILearnerCohortContent): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }

  embedSignature(
    _unsignedPdf: Buffer,
    _signaturePng: Buffer,
    _options: ISignedPdfOptions,
  ): Promise<Buffer> {
    return Promise.resolve(MINIMAL_PDF);
  }
}
