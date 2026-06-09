import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TokenEncryptionService } from './token-encryption.service.js';

import type { DasDonorOAuthToken } from '../entities/das-donor-oauth-token.entity.js';

export interface IDonorOAuthTokenPayload {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string | null;
}

interface IDonorOAuthStatePayload {
  linkId: string;
  orgId: string;
  userId: string;
  exp: number;
}

@Injectable()
export class DasDonorOAuthService {
  private readonly expirySkewMs = 5 * 60 * 1000;
  private readonly stateTtlMs = 15 * 60 * 1000;

  constructor(
    private readonly config: ConfigService,
    private readonly tokenEncryption: TokenEncryptionService,
  ) {}

  isConfigured(): boolean {
    const authorizeUrl = this.config.get<string>(
      'app.levyExchange.donorOAuth.authorizeUrl',
    );
    const tokenUrl = this.config.get<string>(
      'app.levyExchange.donorOAuth.tokenUrl',
    );
    const clientId = this.config.get<string>(
      'app.levyExchange.donorOAuth.clientId',
    );
    const clientSecret = this.config.get<string>(
      'app.levyExchange.donorOAuth.clientSecret',
    );
    const redirectUri = this.config.get<string>(
      'app.levyExchange.donorOAuth.redirectUri',
    );
    return Boolean(
      authorizeUrl && tokenUrl && clientId && clientSecret && redirectUri,
    );
  }

  buildAuthorizeUrl(linkId: string, orgId: string, userId: string): string {
    this.assertConfigured();

    const authorizeUrl = this.config.get<string>(
      'app.levyExchange.donorOAuth.authorizeUrl',
    )!;
    const clientId = this.config.get<string>(
      'app.levyExchange.donorOAuth.clientId',
    )!;
    const redirectUri = this.config.get<string>(
      'app.levyExchange.donorOAuth.redirectUri',
    )!;
    const scope = this.config.get<string>(
      'app.levyExchange.donorOAuth.scope',
      '',
    );

    const url = new URL(authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', this.signState({ linkId, orgId, userId }));
    if (scope.trim()) {
      url.searchParams.set('scope', scope.trim());
    }
    return url.toString();
  }

  verifyState(state: string): IDonorOAuthStatePayload {
    const [payloadPart, signaturePart] = state.split('.');
    if (!payloadPart || !signaturePart) {
      throw new BadRequestException('Invalid OAuth state');
    }

    const expected = this.hmac(payloadPart);
    const actual = Buffer.from(signaturePart, 'base64url');
    const expectedBuf = Buffer.from(expected, 'base64url');
    if (
      actual.length !== expectedBuf.length ||
      !timingSafeEqual(actual, expectedBuf)
    ) {
      throw new BadRequestException('Invalid OAuth state signature');
    }

    let payload: IDonorOAuthStatePayload;
    try {
      payload = JSON.parse(
        Buffer.from(payloadPart, 'base64url').toString('utf8'),
      ) as IDonorOAuthStatePayload;
    } catch {
      throw new BadRequestException('Invalid OAuth state payload');
    }

    if (!payload.linkId || !payload.orgId || !payload.userId || !payload.exp) {
      throw new BadRequestException('Invalid OAuth state payload');
    }
    if (Date.now() > payload.exp) {
      throw new BadRequestException('OAuth state expired');
    }

    return payload;
  }

  async exchangeCode(code: string): Promise<IDonorOAuthTokenPayload> {
    this.assertConfigured();
    const params: Record<string, string> = {
      code,
    };
    params['grant_type'] = 'authorization_code';
    return this.requestToken(params);
  }

  async refreshToken(
    token: DasDonorOAuthToken,
  ): Promise<IDonorOAuthTokenPayload> {
    if (Date.now() + this.expirySkewMs < token.expiresAt.getTime()) {
      return {
        accessToken: this.tokenEncryption.decrypt(token.accessTokenEncrypted),
        refreshToken: token.refreshTokenEncrypted
          ? this.tokenEncryption.decrypt(token.refreshTokenEncrypted)
          : null,
        expiresAt: token.expiresAt,
        scope: token.scope,
      };
    }

    if (!token.refreshTokenEncrypted) {
      throw new BadRequestException('Donor OAuth refresh token missing');
    }

    this.assertConfigured();
    const refreshToken = this.tokenEncryption.decrypt(
      token.refreshTokenEncrypted,
    );
    const params: Record<string, string> = {};
    params['grant_type'] = 'refresh_token';
    params['refresh_token'] = refreshToken;
    return this.requestToken(params);
  }

  encryptTokenPayload(payload: IDonorOAuthTokenPayload): {
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string | null;
    expiresAt: Date;
    scope: string | null;
  } {
    return {
      accessTokenEncrypted: this.tokenEncryption.encrypt(payload.accessToken),
      refreshTokenEncrypted: payload.refreshToken
        ? this.tokenEncryption.encrypt(payload.refreshToken)
        : null,
      expiresAt: payload.expiresAt,
      scope: payload.scope,
    };
  }

  private signState(input: {
    linkId: string;
    orgId: string;
    userId: string;
  }): string {
    const payload: IDonorOAuthStatePayload = {
      ...input,
      exp: Date.now() + this.stateTtlMs,
    };
    const payloadPart = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    return `${payloadPart}.${this.hmac(payloadPart)}`;
  }

  private hmac(payloadPart: string): string {
    const secret = this.config.get<string>('app.jwt.secret', '');
    return createHmac('sha256', secret).update(payloadPart).digest('base64url');
  }

  private async requestToken(
    params: Record<string, string>,
  ): Promise<IDonorOAuthTokenPayload> {
    const tokenUrl = this.config.get<string>(
      'app.levyExchange.donorOAuth.tokenUrl',
    )!;
    const clientId = this.config.get<string>(
      'app.levyExchange.donorOAuth.clientId',
    )!;
    const clientSecret = this.config.get<string>(
      'app.levyExchange.donorOAuth.clientSecret',
    )!;
    const redirectUri = this.config.get<string>(
      'app.levyExchange.donorOAuth.redirectUri',
    )!;
    const timeoutMs = this.config.get<number>('app.das.timeoutMs', 10_000);

    const body = new URLSearchParams();
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    for (const [key, value] of Object.entries(params)) {
      body.set(key, value);
    }
    if (params.grant_type === 'authorization_code') {
      body.set('redirect_uri', redirectUri);
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
        `Donor DAS OAuth token request failed: ${this.toMessage(error)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const payload = await this.safeReadBody(res);
      throw new InternalServerErrorException(
        `Donor DAS OAuth token request failed (${res.status}): ${payload}`,
      );
    }

    const payload = (await res.json()) as Record<string, unknown>;
    const accessToken =
      typeof payload.access_token === 'string' ? payload.access_token : '';
    const refreshToken =
      typeof payload.refresh_token === 'string' ? payload.refresh_token : null;
    const expiresIn =
      typeof payload.expires_in === 'number' ? payload.expires_in : 0;
    const scope = typeof payload.scope === 'string' ? payload.scope : null;

    if (!accessToken || !expiresIn) {
      throw new InternalServerErrorException(
        'Donor DAS OAuth token payload invalid: missing access_token or expires_in',
      );
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scope,
    };
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Donor DAS OAuth is not configured',
      );
    }
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
