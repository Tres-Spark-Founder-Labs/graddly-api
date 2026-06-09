import { isRlsBootstrapRequest } from './rls-bootstrap.middleware.js';

import type { Request } from 'express';

function makeRequest(method: string, url: string): Request {
  return { method, originalUrl: url, url } as Request;
}

describe('isRlsBootstrapRequest', () => {
  it('matches public auth POST routes with API prefix', () => {
    expect(
      isRlsBootstrapRequest(makeRequest('POST', '/api/v1/auth/login')),
    ).toBe(true);
    expect(
      isRlsBootstrapRequest(makeRequest('POST', '/api/v1/auth/signup')),
    ).toBe(true);
    expect(
      isRlsBootstrapRequest(makeRequest('POST', '/api/v1/auth/refresh')),
    ).toBe(true);
  });

  it('matches public auth POST routes with trailing slash', () => {
    expect(
      isRlsBootstrapRequest(makeRequest('POST', '/api/v1/auth/login/')),
    ).toBe(true);
  });

  it('matches OIDC callback GET route', () => {
    expect(
      isRlsBootstrapRequest(
        makeRequest('GET', '/api/v1/auth/oidc/callback?code=abc'),
      ),
    ).toBe(true);
  });

  it('matches invitation accept POST route', () => {
    expect(
      isRlsBootstrapRequest(makeRequest('POST', '/api/v1/invitations/accept')),
    ).toBe(true);
  });

  it('matches levy exchange bootstrap POST routes', () => {
    expect(
      isRlsBootstrapRequest(
        makeRequest('POST', '/api/v1/levy-exchange/matches/search'),
      ),
    ).toBe(true);
    expect(
      isRlsBootstrapRequest(
        makeRequest('POST', '/api/v1/levy-exchange/match-applications'),
      ),
    ).toBe(true);
    expect(
      isRlsBootstrapRequest(
        makeRequest('POST', '/api/v1/levy-exchange/transfers'),
      ),
    ).toBe(true);
    expect(
      isRlsBootstrapRequest(
        makeRequest(
          'POST',
          '/api/v1/levy-exchange/transfers/00000000-0000-4000-8000-000000000001/sign',
        ),
      ),
    ).toBe(true);
  });

  it('does not match authenticated routes', () => {
    expect(isRlsBootstrapRequest(makeRequest('GET', '/api/v1/auth/me'))).toBe(
      false,
    );
    expect(
      isRlsBootstrapRequest(makeRequest('POST', '/api/v1/organisations')),
    ).toBe(false);
  });
});
