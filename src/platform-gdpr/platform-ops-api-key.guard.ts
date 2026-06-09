import { timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PLATFORM_OPS_API_KEY_HEADER } from './platform-gdpr.constants.js';

import type { Request } from 'express';

@Injectable()
export class PlatformOpsApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.get<boolean>('app.platformOps.enabled', false)) {
      throw new ForbiddenException('Platform ops API is disabled');
    }

    const configuredKey = this.config.get<string>('app.platformOps.apiKey', '');
    if (!configuredKey) {
      throw new ForbiddenException('Platform ops API is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const headerValue = request.headers[PLATFORM_OPS_API_KEY_HEADER];
    const providedKey =
      typeof headerValue === 'string'
        ? headerValue
        : Array.isArray(headerValue)
          ? headerValue[0]
          : '';

    if (!this.keysMatch(configuredKey, providedKey)) {
      throw new UnauthorizedException('Invalid platform ops API key');
    }

    return true;
  }

  private keysMatch(expected: string, provided: string): boolean {
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(provided);

    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, providedBuf);
  }
}
