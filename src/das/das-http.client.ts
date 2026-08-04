import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DasApiActivityService } from './das-api-activity.service.js';
import { DasOAuthService } from './das-oauth.service.js';
import { DasApiOperation } from './enums/das-api-operation.enum.js';

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
} from './das.types.js';

@Injectable()
export class DasHttpClient {
  constructor(
    private readonly config: ConfigService,
    private readonly oauth: DasOAuthService,
    private readonly activity: DasApiActivityService,
  ) {}

  /**
   * F2.3.1 AC7 — every DAS request goes through here, and every one is
   * recorded.
   *
   * This method exists because AC7 was unbuildable without it. Each of the six
   * operations previously carried its own copy of: resolve base URL and path,
   * mint a token, set headers, arm an AbortController, fetch, translate a
   * network error, translate a non-2xx, parse JSON. Adding an activity log
   * meant adding it six times and remembering to add it a seventh when the
   * next endpoint arrived — which is how logs end up with holes in exactly
   * the paths nobody exercises.
   *
   * The recording is deliberately in a `finally`-shaped position: a failed
   * call is the case the log exists for, so the row is written before the
   * exception propagates. `DasApiActivityService.record` never throws, so
   * logging cannot turn a successful submission into a failed one.
   */
  private async request<T>({
    operation,
    method,
    pathConfigKey,
    operationLabel,
    searchParams,
    body,
    accessToken,
    requestSummary,
  }: {
    operation: DasApiOperation;
    method: 'GET' | 'POST';
    pathConfigKey: string;
    operationLabel: string;
    searchParams?: Record<string, string | undefined>;
    body?: object;
    accessToken?: string;
    requestSummary?: unknown;
  }): Promise<T> {
    const baseUrl = this.config.get<string>('app.das.baseUrl');
    const path = this.config.get<string>(pathConfigKey);
    const timeoutMs = this.config.get<number>('app.das.timeoutMs', 10_000);

    if (!baseUrl || !path) {
      // Not recorded: no request was attempted, and a misconfiguration is an
      // operator problem rather than an ESFA interaction.
      throw new InternalServerErrorException(
        `${operationLabel} path configuration missing`,
      );
    }

    const token = accessToken ?? (await this.oauth.getAccessToken());
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }

    const headers = new Headers();
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const message = this.toMessage(error);
      await this.activity.record({
        operation,
        method,
        url: url.toString(),
        // No status: we never got a reply. This null is the difference
        // between "the ESFA rejected it" and "we never reached the ESFA".
        responseStatus: null,
        succeeded: false,
        durationMs: Date.now() - startedAt,
        errorMessage: message,
        requestSummary: requestSummary ?? body ?? searchParams,
      });
      throw new InternalServerErrorException(
        `${operationLabel} request failed: ${message}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const durationMs = Date.now() - startedAt;

    if (!res.ok) {
      const payload = await this.safeReadBody(res);
      await this.activity.record({
        operation,
        method,
        url: url.toString(),
        responseStatus: res.status,
        succeeded: false,
        durationMs,
        errorMessage: payload,
        requestSummary: requestSummary ?? body ?? searchParams,
      });
      throw new InternalServerErrorException(
        `${operationLabel} request failed (${res.status}): ${payload}`,
      );
    }

    await this.activity.record({
      operation,
      method,
      url: url.toString(),
      responseStatus: res.status,
      succeeded: true,
      durationMs,
      requestSummary: requestSummary ?? body ?? searchParams,
    });

    return (await res.json()) as T;
  }

  async fetchLevyBalance(
    ukprn: string,
    accessToken?: string,
  ): Promise<IDasLevyBalancePayload> {
    const raw = await this.request<Record<string, unknown>>({
      operation: DasApiOperation.LEVY_BALANCE,
      method: 'GET',
      pathConfigKey: 'app.das.levyBalancePath',
      operationLabel: 'DAS levy',
      searchParams: { ukprn },
      accessToken,
    });

    return {
      accountId: this.pickString(raw, [
        'accountId',
        'accountID',
        'dasAccountId',
      ]),
      balance: this.pickNumericString(raw, ['balance', 'levyBalance']),
      currency: this.pickString(raw, ['currency']) ?? 'GBP',
      raw,
    };
  }

  async fetchFundingPayments(
    ukprn: string,
    query: IDasFundingPaymentsQuery = {},
    accessToken?: string,
  ): Promise<IDasFundingPaymentPayload[]> {
    const body = await this.request<Record<string, unknown> | unknown[]>({
      operation: DasApiOperation.FUNDING_PAYMENTS,
      method: 'GET',
      pathConfigKey: 'app.das.fundingPaymentsPath',
      operationLabel: 'DAS funding payments',
      searchParams: { ukprn, from: query.from, to: query.to },
      accessToken,
    });

    const rows = Array.isArray(body)
      ? body
      : [
          ...toUnknownArray(body.payments),
          ...toUnknownArray(body.fundingPayments),
        ];

    return rows
      .map((item) => this.parseFundingPaymentItem(item))
      .filter((item): item is IDasFundingPaymentPayload => item !== null);
  }

  private parseFundingPaymentItem(
    item: unknown,
  ): IDasFundingPaymentPayload | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const raw = item as Record<string, unknown>;
    const externalReference =
      this.pickString(raw, [
        'externalReference',
        'reference',
        'paymentReference',
        'id',
      ]) ?? null;
    const paymentDate =
      this.pickString(raw, ['paymentDate', 'date', 'paidOn']) ?? null;
    const amount = this.pickNumericString(raw, ['amount', 'paymentAmount']);
    if (!externalReference || !paymentDate || !amount) {
      return null;
    }

    return {
      externalReference,
      paymentDate: paymentDate.slice(0, 10),
      amount,
      currency: this.pickString(raw, ['currency']) ?? 'GBP',
      fundingPeriod: this.pickString(raw, ['fundingPeriod', 'period']),
      clawbackNotice: this.pickString(raw, [
        'clawbackNotice',
        'clawback',
        'clawbackReason',
      ]),
      learnerRef: this.pickString(raw, [
        'learnerRef',
        'learnerReference',
        'learnerId',
        'uln',
      ]),
      raw,
    };
  }

  async createLevyTransferConsent(
    request: IDasTransferConsentRequest,
    accessToken: string,
  ): Promise<IDasTransferConsentResult> {
    const raw = await this.request<Record<string, unknown>>({
      operation: DasApiOperation.TRANSFER_CONSENT,
      method: 'POST',
      pathConfigKey: 'app.das.transferConsentPath',
      operationLabel: 'DAS transfer consent',
      body: request,
      accessToken,
    });

    return {
      reference: this.pickString(raw, [
        'reference',
        'transferReference',
        'esfaTransferReference',
      ]),
      status: this.pickString(raw, ['status', 'transferStatus']),
      raw,
    };
  }

  async fetchTransferStatus(
    reference: string,
    accessToken: string,
  ): Promise<IDasTransferStatusPayload> {
    const raw = await this.request<Record<string, unknown>>({
      operation: DasApiOperation.TRANSFER_STATUS,
      method: 'GET',
      pathConfigKey: 'app.das.transferStatusPath',
      operationLabel: 'DAS transfer status',
      searchParams: { reference },
      accessToken,
    });

    return {
      reference,
      status: this.pickString(raw, ['status', 'transferStatus']),
      amountsReleased: this.pickNumericString(raw, [
        'amountsReleased',
        'amountReleased',
        'releasedAmount',
      ]),
      paymentDates: this.pickStringArray(raw, [
        'paymentDates',
        'paymentDate',
        'dates',
      ]),
      raw,
    };
  }

  async submitEnrolment(
    request: IDasEnrolmentSubmissionRequest,
    accessToken?: string,
  ): Promise<IDasEnrolmentSubmissionResult> {
    return this.postDasJson(
      DasApiOperation.ENROLMENT_SUBMIT,
      'app.das.enrolmentSubmitPath',
      'DAS enrolment submission',
      request,
      accessToken,
      ['reference', 'enrolmentReference', 'dasEnrolmentReference'],
      ['status', 'enrolmentStatus'],
    );
  }

  async notifyCompletion(
    request: IDasCompletionNotificationRequest,
    accessToken?: string,
  ): Promise<IDasCompletionNotificationResult> {
    return this.postDasJson(
      DasApiOperation.COMPLETION_NOTIFY,
      'app.das.completionNotifyPath',
      'DAS completion notification',
      request,
      accessToken,
      ['reference', 'completionReference', 'dasCompletionReference'],
      ['status', 'completionStatus'],
    );
  }

  private async postDasJson(
    operation: DasApiOperation,
    pathConfigKey: string,
    operationLabel: string,
    body: object,
    accessToken: string | undefined,
    referenceKeys: string[],
    statusKeys: string[],
  ): Promise<{
    reference: string | null;
    status: string | null;
    raw: Record<string, unknown>;
  }> {
    const raw = await this.request<Record<string, unknown>>({
      operation,
      method: 'POST',
      pathConfigKey,
      operationLabel,
      body,
      accessToken,
    });

    return {
      reference: this.pickString(raw, referenceKeys),
      status: this.pickString(raw, statusKeys),
      raw,
    };
  }

  private pickString(
    raw: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  private pickStringArray(
    raw: Record<string, unknown>,
    keys: string[],
  ): string[] | null {
    for (const key of keys) {
      const value = raw[key];
      if (Array.isArray(value)) {
        const strings = value.filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        );
        if (strings.length > 0) {
          return strings;
        }
      }
      if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
      }
    }
    return null;
  }

  private pickNumericString(
    raw: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toFixed(2);
      }
      if (typeof value === 'string' && value.trim()) {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
          return asNumber.toFixed(2);
        }
      }
    }
    return null;
  }

  private async safeReadBody(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return '<unavailable>';
    }
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

function toUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
