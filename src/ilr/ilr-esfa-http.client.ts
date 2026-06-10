/**
 * HTTP ESFA submit client. Sends ILR XML when xmlPayload is set (default for http provider).
 * Parses flexible JSON response keys from stub/sandbox endpoints.
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
    const payloadFormat = this.config.get<'json' | 'xml'>(
      'app.ilr.esfa.payloadFormat',
      'xml',
    );

    if (!baseUrl) {
      throw new InternalServerErrorException(
        'ILR ESFA base URL configuration missing',
      );
    }

    const token = await this.oauth.getAccessToken();
    const url = new URL(submitPath, baseUrl);
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${token}`);

    const useXml =
      payloadFormat === 'xml' &&
      typeof request.xmlPayload === 'string' &&
      request.xmlPayload.length > 0;

    let body: string;
    if (useXml) {
      headers.set('Content-Type', 'application/xml');
      headers.set('Accept', 'application/json');
      body = request.xmlPayload!;
    } else {
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'application/json');
      body = JSON.stringify({
        ukprn: request.ukprn,
        collectionPeriod: request.collectionPeriod,
        academicYear: request.academicYear,
        isAmendment: request.isAmendment,
        priorEsfaReference: request.priorEsfaReference ?? null,
        learnerRecordId: request.learnerRecordId,
        fields: request.fields,
      });
    }

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
