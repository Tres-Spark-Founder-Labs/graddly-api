import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

import { setRlsBootstrap } from '../context/correlation-id-context.js';

const BOOTSTRAP_AUTH_POST_SUFFIXES = [
  '/auth/signup',
  '/auth/login',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/auth/resend-verification',
  '/invitations/accept',
  '/levy-exchange/matches/search',
  '/levy-exchange/match-applications',
] as const;

const BOOTSTRAP_AUTH_GET_SUFFIXES = [
  '/auth/oidc/callback',
  '/levy-exchange/donor-links/oauth/callback',
] as const;

const BOOTSTRAP_PLATFORM_OPS_POST_SUFFIXES = [
  '/platform/gdpr/erasure',
] as const;

function normalizeRequestPath(request: Request): string {
  const path = (request.originalUrl ?? request.url ?? '').split('?')[0];
  return path.replace(/\/+$/, '') || '/';
}

export function isRlsBootstrapRequest(request: Request): boolean {
  const path = normalizeRequestPath(request);

  if (request.method === 'GET') {
    return BOOTSTRAP_AUTH_GET_SUFFIXES.some((suffix) => path.endsWith(suffix));
  }

  if (request.method !== 'POST') {
    return false;
  }

  if (
    BOOTSTRAP_PLATFORM_OPS_POST_SUFFIXES.some((suffix) => path.endsWith(suffix))
  ) {
    return true;
  }

  if (path.includes('/levy-exchange/transfers')) {
    return true;
  }

  return BOOTSTRAP_AUTH_POST_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

@Injectable()
export class RlsBootstrapMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    if (!isRlsBootstrapRequest(req)) {
      next();
      return;
    }

    setRlsBootstrap(true);
    // Do not clear bootstrap on `finish`/`close`: CorrelationIdMiddleware already
    // resets tenant ALS state per request. Clearing here can run after the next
    // request started and disable bootstrap on that request's connection.
    next();
  }
}
