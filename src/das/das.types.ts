export interface IDasLevyBalancePayload {
  accountId: string | null;
  balance: string | null;
  currency: string | null;
  raw: Record<string, unknown>;
}

export interface IDasTransferConsentRequest {
  amount: string;
  recipientAccount: string;
  startDate: string;
  ukprn?: string;
}

export interface IDasTransferConsentResult {
  reference: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export interface IDasTransferStatusPayload {
  reference: string;
  status: string | null;
  amountsReleased: string | null;
  paymentDates: string[] | null;
  raw: Record<string, unknown>;
}

export interface IDasEnrolmentSubmissionRequest {
  ukprn: string;
  learnerRef: string;
  standardCode: string;
  givenNames: string;
  familyName: string;
  plannedStartDate: string;
  plannedEndDate: string | null;
}

export interface IDasEnrolmentSubmissionResult {
  reference: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export interface IDasCompletionNotificationRequest {
  learnerRef: string;
  completionDate: string;
  epaOutcome: string | null;
}

export interface IDasCompletionNotificationResult {
  reference: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export interface IDasFundingPaymentPayload {
  externalReference: string;
  paymentDate: string;
  amount: string;
  currency: string;
  fundingPeriod: string | null;
  clawbackNotice: string | null;
  learnerRef: string | null;
  raw: Record<string, unknown>;
}

export interface IDasFundingPaymentsQuery {
  from?: string;
  to?: string;
}
