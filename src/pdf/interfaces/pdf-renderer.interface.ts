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

export interface ILevyRoiReportContent {
  organisationName: string;
  logoUrl: string | null;

  /**
   * F1.1.5 AC2 — the logo as raw bytes. PDFKit cannot draw from a URL, and the
   * renderer must stay synchronous and side-effect free, so fetching happens
   * upstream (in the job processor) and the bytes are passed in. Null when the
   * organisation has no logo or the fetch failed.
   */
  logoBytes?: Buffer | null;
  summary: {
    totalLevySpendToDate: number;
    availableBalance: number | null;
    currency: string | null;
    utilisationPercent: number | null;
    activeApprenticeCount: number;
    completionCount: number;
    averageCostPerCompletion: number | null;
    epaPassRate: number | null;
    /** How many assessments the rate rests on — see AC1. */
    epaAssessedCount?: number;
    estimatedProductivityUplift: number;
    monthlyContributions: Array<{ month: string; amount: number }>;
    utilisationSegments?: {
      used: number;
      expiringWithin90Days: number;
      available: number;
      currency: string;
    } | null;
  };

  /**
   * F1.1.5 AC1 — the report must carry the forward forecast, not only history.
   * Optional so existing callers and fixtures stay valid; the renderer omits
   * the section when absent rather than printing zeros.
   */
  forecast?: {
    horizonMonths: number;
    activeEnrolmentCount: number;
    projectedMonthlySpend: number;
    projectedCompletionLiability: number;
    estimatedRunwayMonths: number | null;
  } | null;
  /**
   * F1.4.1 AC3 — the year-on-year comparison.
   *
   * Optional, and omitted rather than zeroed when there is no prior year:
   * the renderer prints a line saying the comparison is unavailable, which
   * is a statement a board can act on. "0%" is not.
   */
  yearOnYear?: {
    currentPeriod: ILevyRoiPeriod;
    priorPeriod: ILevyRoiPeriod | null;
    hasPriorPeriodData: boolean;
    startsChangePercent: number | null;
    completionsChangePercent: number | null;
    levySpendChangePercent: number | null;
    epaPassRatePointChange: number | null;
  } | null;

  breakdownByProvider: Array<{
    label: string;
    activeApprenticeCount: number;
    completionCount: number;
    averageCostPerCompletion: number | null;
    /** F1.4.1 AC2 — side-by-side comparison includes the outcome measure. */
    epaPassRate?: number | null;
    epaAssessedCount?: number;
    reviewComplianceRate?: number | null;
    withdrawalRate?: number | null;
  }>;
  breakdownByStandard: Array<{
    label: string;
    code?: string;
    activeApprenticeCount: number;
    completionCount: number;
    averageCostPerCompletion: number | null;
    epaPassRate?: number | null;
    epaAssessedCount?: number;
    reviewComplianceRate?: number | null;
    withdrawalRate?: number | null;
  }>;
  generatedAt: string;
}

export interface ILevyRoiPeriod {
  label: string;
  starts: number;
  completions: number;
  withdrawals: number;
  levySpend: number;
  averageCostPerCompletion: number | null;
  epaPassRate: number | null;
}

/**
 * F1.3.3 AC3 — "audit trail is exportable as PDF in Ofsted-ready format".
 *
 * "Ofsted-ready" is not a defined file format, so it is read here as what an
 * inspector needs to accept a document as evidence: it must identify the
 * record it belongs to, be readable without knowing the schema, state its own
 * completeness (the filter applied and the number of entries), and say when
 * and by whom it was produced. A CSV of column diffs satisfies none of that,
 * which is why the existing export was not enough.
 */
export interface ICommitmentAuditTrailContent {
  organisationName: string;

  /** Identity of the record the trail belongs to. */
  statementId: string;
  currentVersion: number;
  status: string;
  apprenticeName: string;
  employerName: string | null;
  providerName: string | null;

  /**
   * Every version of the statement, so a reader can see the entries below
   * refer to more than one document.
   */
  versions: Array<{
    version: number;
    statementId: string;
    status: string;
    createdAt: string;
    supersededAt: string | null;
  }>;

  entries: Array<{
    /** ISO 8601 UTC — an audit timestamp with no zone is not evidence. */
    at: string;
    actorName: string;
    actorRole: string;
    action: string;
    description: string;
    /** Rendered as a readable list, not raw JSON. */
    changeSummary: string | null;
  }>;

  /**
   * Provenance. An export with no stated scope invites the question "is this
   * all of it?", which is the one question an evidence document must answer.
   */
  entryCount: number;
  rangeFrom: string | null;
  rangeTo: string | null;
  generatedAt: string;
  generatedByName: string;
}

/**
 * F1.4.2 AC3 — "comparison is exportable as … PDF".
 *
 * A document of its own rather than the breakdown section buried in the levy
 * ROI report. This is the artefact an employer takes into a provider review
 * meeting, and it has to stand alone: name the providers, state the five
 * metrics, and say plainly that the figures come from the platform rather
 * than from the providers themselves (AC2), because that is the claim which
 * makes the comparison worth having.
 */
export interface IProviderComparisonContent {
  organisationName: string;
  logoBytes?: Buffer | null;
  rows: Array<{
    label: string;
    activeApprenticeCount: number;
    completionCount: number;
    averageOtjPercent: number | null;
    reviewComplianceRate: number | null;
    epaPassRate: number | null;
    epaAssessedCount: number;
    withdrawalRate: number | null;
  }>;
  generatedAt: string;
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
  renderLevyRoiReport(content: ILevyRoiReportContent): Promise<Buffer>;
  renderCommitmentAuditTrail(
    content: ICommitmentAuditTrailContent,
  ): Promise<Buffer>;
  renderProviderComparison(
    content: IProviderComparisonContent,
  ): Promise<Buffer>;
  embedSignature(
    unsignedPdf: Buffer,
    signaturePng: Buffer,
    options: ISignedPdfOptions,
  ): Promise<Buffer>;
}
