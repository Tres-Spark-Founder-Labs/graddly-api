/**
 * HTTP ESFA submit client (REST stub). Parses flexible response keys.
 * GROWTH: receipt polling endpoint, amend-specific path when sandbox contract is known.
 */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { IlrEsfaOAuthService } from './ilr-esfa-oauth.service.js';

import type {
  IIlrEsfaClient,
  IIlrEsfaSubmitRequest,
  IIlrEsfaSubmitResult,
} from './interfaces/ilr-esfa.client.interface.js';

@Injectable()
export class IlrEsfaHttpClient implements IIlrEsfaClient {
  constructor(
    private readonly config: ConfigService,
    private readonly oauth: IlrEsfaOAuthService,
  ) {}

  async submit(request: IIlrEsfaSubmitRequest): Promise<IIlrEsfaSubmitResult> {
    const baseUrl = this.config.get<string>('app.ilr.esfa.baseUrl');
    const submitPath = this.config.get<string>(
      'app.ilr.esfa.submitPath',
      '/api/v1/ilr/submit',
    );
    const timeoutMs = this.config.get<number>('app.ilr.esfa.timeoutMs', 15_000);

    if (!baseUrl) {
      throw new InternalServerErrorException(
        'ILR ESFA base URL configuration missing',
      );
    }

    const token = await this.oauth.getAccessToken();
    const url = new URL(submitPath, baseUrl);
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    headers.set('Content-Type', 'application/json');

    const body = JSON.stringify({
      ukprn: request.ukprn,
      collectionPeriod: request.collectionPeriod,
      academicYear: request.academicYear,
      isAmendment: request.isAmendment,
      priorEsfaReference: request.priorEsfaReference ?? null,
      learnerRecordId: request.learnerRecordId,
      fields: request.fields,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `ILR ESFA submit request failed: ${this.toMessage(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = await this.safeReadBody(res);
    if (!res.ok) {
      throw new InternalServerErrorException(
        `ILR ESFA submit request failed (${res.status}): ${rawText}`,
      );
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new InternalServerErrorException(
        'ILR ESFA submit response was not valid JSON',
      );
    }

    const esfaReference = this.pickString(raw, [
      'esfaReference',
      'reference',
      'submissionId',
    ]);
    if (!esfaReference) {
      throw new InternalServerErrorException(
        'ILR ESFA submit response missing reference',
      );
    }

    return { esfaReference, receipt: raw };
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
