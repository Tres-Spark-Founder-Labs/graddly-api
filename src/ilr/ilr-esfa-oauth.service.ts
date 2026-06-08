/**
 * OAuth client-credentials for ILR ESFA REST stub (mirrors DasOAuthService).
 * GROWTH: token cache TTL tuning; separate credentials from DAS if scopes diverge.
 */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ICachedToken {
  accessToken: string;
  expiresAtEpochMs: number;
}

@Injectable()
export class IlrEsfaOAuthService {
  private cachedToken: ICachedToken | null = null;
  private readonly expirySkewMs = 30_000;

  constructor(private readonly config: ConfigService) {}

  async getAccessToken(): Promise<string> {
    if (
      this.cachedToken &&
      Date.now() + this.expirySkewMs < this.cachedToken.expiresAtEpochMs
    ) {
      return this.cachedToken.accessToken;
    }

    const token = await this.fetchToken();
    this.cachedToken = token;
    return token.accessToken;
  }

  private async fetchToken(): Promise<ICachedToken> {
    const tokenUrl = this.config.get<string>('app.ilr.esfa.tokenUrl');
    const clientId = this.config.get<string>('app.ilr.esfa.clientId');
    const clientSecret = this.config.get<string>('app.ilr.esfa.clientSecret');
    const scope = this.config.get<string>('app.ilr.esfa.scope', '');
    const timeoutMs = this.config.get<number>('app.ilr.esfa.timeoutMs', 15_000);

    if (!tokenUrl || !clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'ILR ESFA OAuth configuration missing',
      );
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    if (scope.trim()) {
      body.set('scope', scope.trim());
    }

    const headers = new Headers();
    headers.set('Content-Type', 'application/x-www-form-urlencoded');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers,
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `ILR ESFA OAuth token request failed: ${this.toMessage(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const payload = await this.safeReadBody(res);
      throw new InternalServerErrorException(
        `ILR ESFA OAuth token request failed (${res.status}): ${payload}`,
      );
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const accessToken =
      typeof payload.access_token === 'string' ? payload.access_token : '';
    const expiresIn =
      typeof payload.expires_in === 'number' ? payload.expires_in : 0;

    if (!accessToken || !expiresIn) {
      throw new InternalServerErrorException(
        'ILR ESFA OAuth token payload invalid: missing access_token or expires_in',
      );
    }

    return {
      accessToken,
      expiresAtEpochMs: Date.now() + expiresIn * 1000,
    };
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
