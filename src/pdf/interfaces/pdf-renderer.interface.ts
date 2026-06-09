export interface ISignedPdfOptions {
  signedAt: Date;
  signerLabel?: string;
}

export interface ICommitmentSnapshotContent {
  version: number;
  apprenticeName: string;
  trainingPlanSummary: string;
  employerCommitments: string;
  apprenticeCommitments: string;
  providerCommitments: string;
  weeklyHours?: number;
  additionalTerms?: string;
}

export interface ILevyTransferAgreementContent {
  donorOrganisationName: string;
  recipientOrganisationName: string;
  amount: string;
  startDate: string | null;
  programmeDetails?: Record<string, unknown> | null;
}

export interface IReviewSnapshotContent {
  title: string | null;
  scheduledAt: string;
  apprenticeName: string;
  progressSummary?: string;
  actionsAgreed?: string;
  employerComments?: string;
  smartGoals?: Array<{
    objective: string;
    measurable: string;
    achievable: string;
    relevant: string;
    timeBound: string;
  }>;
  wellbeingScore?: number;
  wellbeingNotes?: string;
}

export interface IPdfRenderer {
  renderHelloPdf(): Promise<Buffer>;
  renderReviewSnapshot(content: IReviewSnapshotContent): Promise<Buffer>;
  renderCommitmentSnapshot(
    content: ICommitmentSnapshotContent,
  ): Promise<Buffer>;
  renderLevyTransferAgreement(
    content: ILevyTransferAgreementContent,
  ): Promise<Buffer>;
  embedSignature(
    unsignedPdf: Buffer,
    signaturePng: Buffer,
    options: ISignedPdfOptions,
  ): Promise<Buffer>;
}
