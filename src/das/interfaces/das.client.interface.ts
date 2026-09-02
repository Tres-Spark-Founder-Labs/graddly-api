import type {
  IDasCompletionNotificationRequest,
  IDasCompletionNotificationResult,
  IDasEnrolmentSubmissionRequest,
  IDasEnrolmentSubmissionResult,
  IDasFundingPaymentPayload,
  IDasFundingPaymentsQuery,
  IDasLevyBalancePayload,
  IDasTransferConsentRequest,
  IDasTransferConsentResult,
  IDasTransferStatusPayload,
} from '../das.types.js';

/**
 * The boundary between "what the platform needs from DAS" and "how it gets it".
 *
 * Two implementations satisfy this: `DasHttpClient` calls the real ESFA
 * Digital Apprenticeship Service, and `DasManualClient` reads figures an
 * administrator entered by hand. `DasModule` picks one from config, following
 * the same shape as `FlowportalRegistrationModule`'s Companies House client.
 *
 * The point is that a deployment without ESFA credentials is a working
 * deployment, not a broken one. Access to the DAS API takes weeks to arrange;
 * nothing else in the platform should wait on it.
 *
 * ── EVERY METHOD HERE EXISTS ON THE HTTP CLIENT ─────────────────────────────
 *
 * The brief listed seven methods including `notifyWithdrawal` and named the
 * consent method `createTransferConsent`. Neither matches the code:
 * `notifyWithdrawal` does not exist anywhere in the repository — withdrawals
 * run through `withdrawal-push-dispatch.service.ts`, which never touches the
 * DAS client — and the consent method is `createLevyTransferConsent`. This
 * interface mirrors what `DasHttpClient` actually exposes, because an
 * interface that promises a method nobody implements is a compile error at
 * best and a runtime hole at worst.
 */
export interface IDasClient {
  fetchLevyBalance(
    ukprn: string,
    accessToken?: string,
  ): Promise<IDasLevyBalancePayload>;

  fetchFundingPayments(
    ukprn: string,
    query?: IDasFundingPaymentsQuery,
    accessToken?: string,
  ): Promise<IDasFundingPaymentPayload[]>;

  createLevyTransferConsent(
    request: IDasTransferConsentRequest,
    accessToken: string,
  ): Promise<IDasTransferConsentResult>;

  fetchTransferStatus(
    reference: string,
    accessToken: string,
  ): Promise<IDasTransferStatusPayload>;

  submitEnrolment(
    request: IDasEnrolmentSubmissionRequest,
    accessToken?: string,
  ): Promise<IDasEnrolmentSubmissionResult>;

  notifyCompletion(
    request: IDasCompletionNotificationRequest,
    accessToken?: string,
  ): Promise<IDasCompletionNotificationResult>;
}
