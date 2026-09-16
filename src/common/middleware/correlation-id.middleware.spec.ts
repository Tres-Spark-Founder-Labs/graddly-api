jest.mock('@sentry/nestjs', () => ({
  getIsolationScope: jest.fn(),
}));

import * as Sentry from '@sentry/nestjs';

import {
  getContextLabel,
  getCorrelationId,
  getCurrentOrganisationId,
} from '../context/correlation-id-context.js';

import {
  CorrelationIdMiddleware,
  resolveCorrelationId,
} from './correlation-id.middleware.js';

import type { NextFunction, Request, Response } from 'express';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Builds Express `headers` with lowercase HTTP header keys (not eslint property literals). */
function headersFrom(options: {
  requestId?: string | string[];
  correlationId?: string | string[];
}): Record<string, string | string[] | undefined> {
  const h: Record<string, string | string[] | undefined> = {};
  if (options.requestId !== undefined) {
    h['x-request-id'] = options.requestId;
  }
  if (options.correlationId !== undefined) {
    h['x-correlation-id'] = options.correlationId;
  }
  return h;
}

function makeReq(options: Parameters<typeof headersFrom>[0]): Request {
  return {
    headers: headersFrom(options),
    method: 'GET',
    originalUrl: '/api/v1/learners?page=2',
  } as Request;
}

describe('resolveCorrelationId', () => {
  it('generates a UUID when no header is present', () => {
    const id = resolveCorrelationId(makeReq({}));
    expect(id).toMatch(UUID_RE);
  });

  it('uses X-Request-Id when valid', () => {
    expect(
      resolveCorrelationId(makeReq({ requestId: '  upstream-id  ' })),
    ).toBe('upstream-id');
  });

  it('falls back to X-Correlation-Id when X-Request-Id is absent', () => {
    expect(resolveCorrelationId(makeReq({ correlationId: 'corr-1' }))).toBe(
      'corr-1',
    );
  });

  it('prefers X-Request-Id over X-Correlation-Id', () => {
    expect(
      resolveCorrelationId(
        makeReq({
          requestId: 'primary',
          correlationId: 'secondary',
        }),
      ),
    ).toBe('primary');
  });

  it('generates UUID when incoming id is empty or whitespace', () => {
    const id1 = resolveCorrelationId(makeReq({ requestId: '   ' }));
    const id2 = resolveCorrelationId(makeReq({ requestId: '' }));
    expect(id1).toMatch(UUID_RE);
    expect(id2).toMatch(UUID_RE);
    expect(id1).not.toBe(id2);
  });

  it('generates UUID when incoming id exceeds max length', () => {
    const tooLong = 'x'.repeat(129);
    const id = resolveCorrelationId(makeReq({ requestId: tooLong }));
    expect(id).toMatch(UUID_RE);
  });

  it('uses first element when header is an array', () => {
    expect(
      resolveCorrelationId(makeReq({ requestId: ['first-id', 'ignored'] })),
    ).toBe('first-id');
  });
});

describe('CorrelationIdMiddleware', () => {
  let setTag: jest.Mock;

  beforeEach(() => {
    setTag = jest.fn();
    jest.clearAllMocks();
    jest.mocked(Sentry.getIsolationScope).mockReturnValue({
      setTag,
    } as unknown as ReturnType<typeof Sentry.getIsolationScope>);
  });

  it('sets header, ALS, Sentry tag, and calls next', () => {
    const middleware = new CorrelationIdMiddleware();
    const req = makeReq({});
    const setHeader = jest.fn();
    const res = {
      setHeader,
      on: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      expect.stringMatching(UUID_RE),
    );
    expect(setTag).toHaveBeenCalledWith(
      'correlation_id',
      expect.stringMatching(UUID_RE),
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('propagates client-supplied X-Request-Id', () => {
    const middleware = new CorrelationIdMiddleware();
    const req = makeReq({ requestId: 'client-id' });
    const setHeader = jest.fn();
    const res = {
      setHeader,
      on: jest.fn(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(req, res, next);

    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'client-id');
    expect(setTag).toHaveBeenCalledWith('correlation_id', 'client-id');
  });

  /**
   * The store the request runs in: labelled with its route, query string
   * dropped, so a tenant warning names the route — and carrying no
   * organisation, which the guards set later. Nothing from a previous request
   * is on it; there is no process-global copy for one to be read from.
   */
  it('enters a store labelled with the route and no organisation', () => {
    const middleware = new CorrelationIdMiddleware();
    const res = { setHeader: jest.fn() } as unknown as Response;
    let seen: {
      correlationId?: string;
      label?: string;
      organisationId?: string;
    } = {};
    const next = jest.fn(() => {
      seen = {
        correlationId: getCorrelationId(),
        label: getContextLabel(),
        organisationId: getCurrentOrganisationId(),
      };
    }) as NextFunction;

    middleware.use(makeReq({ requestId: 'client-id' }), res, next);

    expect(seen).toEqual({
      correlationId: 'client-id',
      label: 'GET /api/v1/learners',
      organisationId: undefined,
    });
  });
});
