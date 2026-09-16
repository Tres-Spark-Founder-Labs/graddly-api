import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { NextFunction, Request, Response } from 'express';

import { enterCorrelationContext } from '../context/correlation-id-context.js';

const MAX_INCOMING_ID_LENGTH = 128;

function sanitizeIncomingId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_INCOMING_ID_LENGTH) {
    return undefined;
  }
  return trimmed;
}

function readIncomingCorrelationId(req: Request): string | undefined {
  const single = (header: string): unknown => {
    const raw = req.headers[header];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  return (
    sanitizeIncomingId(single('x-request-id')) ??
    sanitizeIncomingId(single('x-correlation-id'))
  );
}

export function resolveCorrelationId(req: Request): string {
  return readIncomingCorrelationId(req) ?? randomUUID();
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = resolveCorrelationId(req);
    res.setHeader('X-Request-Id', correlationId);
    // The request's own store, labelled with its route for tenant warnings.
    // Nothing is cleared on finish: the store ends with the request's async
    // chain, and there is no process-global tenant state left to reset — the
    // clear that used to run here could land after the next request had
    // started, which was one of the ways one request's tenant reached another.
    enterCorrelationContext({
      correlationId,
      label: `${req.method} ${req.originalUrl.split('?')[0]}`,
    });
    Sentry.getIsolationScope().setTag('correlation_id', correlationId);
    next();
  }
}
