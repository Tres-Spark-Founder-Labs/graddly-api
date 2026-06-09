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
