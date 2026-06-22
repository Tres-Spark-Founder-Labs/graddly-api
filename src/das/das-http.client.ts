import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DasOAuthService } from './das-oauth.service.js';

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
  ) {}

  async fetchLevyBalance(
    ukprn: string,
    accessToken?: string,
  ): Promise<IDasLevyBalancePayload> {
    const baseUrl = this.config.get<string>('app.das.baseUrl');
    const levyBalancePath = this.config.get<string>('app.das.levyBalancePath');
    const timeoutMs = this.config.get<number>('app.das.timeoutMs', 10_000);

    if (!baseUrl || !levyBalancePath) {
      throw new InternalServerErrorException(
        'DAS base URL configuration missing',
      );
    }

    const token = accessToken ?? (await this.oauth.getAccessToken());
    const url = new URL(levyBalancePath, baseUrl);
    url.searchParams.set('ukprn', ukprn);
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `DAS levy request failed: ${this.toMessage(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const payload = await this.safeReadBody(res);
      throw new InternalServerErrorException(
        `DAS levy request failed (${res.status}): ${payload}`,
      );
    }

    const raw = (await res.json()) as Record<string, unknown>;
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
    const baseUrl = this.config.get<string>('app.das.baseUrl');
    const fundingPaymentsPath = this.config.get<string>(
      'app.das.fundingPaymentsPath',
    );
    const timeoutMs = this.config.get<number>('app.das.timeoutMs', 10_000);

    if (!baseUrl || !fundingPaymentsPath) {
      throw new InternalServerErrorException(
        'DAS funding payments path configuration missing',
      );
    }

    const token = accessToken ?? (await this.oauth.getAccessToken());
    const url = new URL(fundingPaymentsPath, baseUrl);
    url.searchParams.set('ukprn', ukprn);
    if (query.from) {
      url.searchParams.set('from', query.from);
    }
    if (query.to) {
      url.searchParams.set('to', query.to);
    }

    const headers = new Headers();
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `DAS funding payments request failed: ${this.toMessage(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const payload = await this.safeReadBody(res);
      throw new InternalServerErrorException(
        `DAS funding payments request failed (${res.status}): ${payload}`,
      );
    }

    const body = (await res.json()) as Record<string, unknown> | unknown[];
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
    const baseUrl = this.config.get<string>('app.das.baseUrl');
    const transferConsentPath = this.config.get<string>(
      'app.das.transferConsentPath',
    );
    const timeoutMs = this.config.get<number>('app.das.timeoutMs', 10_000);

    if (!baseUrl || !transferConsentPath) {
      throw new InternalServerErrorException(
        'DAS transfer consent path configuration missing',
      );
    }

    const url = new URL(transferConsentPath, baseUrl);
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Accept', 'application/json');
    headers.set('Content-Type', 'application/json');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `DAS transfer consent request failed: ${this.toMessage(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const payload = await this.safeReadBody(res);
      throw new InternalServerErrorException(
        `DAS transfer consent request failed (${res.status}): ${payload}`,
      );
    }

    const raw = (await res.json()) as Record<string, unknown>;
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
    const baseUrl = this.config.get<string>('app.das.baseUrl');
    const transferStatusPath = this.config.get<string>(
      'app.das.transferStatusPath',
    );
    const timeoutMs = this.config.get<number>('app.das.timeoutMs', 10_000);

    if (!baseUrl || !transferStatusPath) {
      throw new InternalServerErrorException(
        'DAS transfer status path configuration missing',
      );
    }

    const url = new URL(transferStatusPath, baseUrl);
    url.searchParams.set('reference', reference);
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Accept', 'application/json');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `DAS transfer status request failed: ${this.toMessage(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const payload = await this.safeReadBody(res);
      throw new InternalServerErrorException(
        `DAS transfer status request failed (${res.status}): ${payload}`,
      );
    }

    const raw = (await res.json()) as Record<string, unknown>;
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
      'app.das.completionNotifyPath',
      'DAS completion notification',
      request,
      accessToken,
      ['reference', 'completionReference', 'dasCompletionReference'],
      ['status', 'completionStatus'],
    );
  }

  private async postDasJson(
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
    const baseUrl = this.config.get<string>('app.das.baseUrl');
    const path = this.config.get<string>(pathConfigKey);
    const timeoutMs = this.config.get<number>('app.das.timeoutMs', 10_000);

    if (!baseUrl || !path) {
      throw new InternalServerErrorException(
        `${operationLabel} path configuration missing`,
      );
    }

    const token = accessToken ?? (await this.oauth.getAccessToken());
    const url = new URL(path, baseUrl);
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    headers.set('Content-Type', 'application/json');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `${operationLabel} request failed: ${this.toMessage(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const payload = await this.safeReadBody(res);
      throw new InternalServerErrorException(
        `${operationLabel} request failed (${res.status}): ${payload}`,
      );
    }

    const raw = (await res.json()) as Record<string, unknown>;
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
