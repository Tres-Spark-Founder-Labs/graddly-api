import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RLS_BOOTSTRAP_ROUTES,
  isRlsBootstrapRequest,
} from './rls-bootstrap.middleware.js';

import type { Request } from 'express';

function makeRequest(method: string, url: string): Request {
  return { method, originalUrl: url, url } as Request;
}

const TRANSFER_ID = '00000000-0000-4000-8000-000000000001';

describe('isRlsBootstrapRequest', () => {
  it('matches public auth POST routes with API prefix', () => {
    for (const path of ['login', 'signup', 'refresh']) {
      expect(
        isRlsBootstrapRequest(makeRequest('POST', `/api/v1/auth/${path}`)),
      ).toBe(true);
    }
  });

  it('matches public auth POST routes with trailing slash', () => {
    expect(
      isRlsBootstrapRequest(makeRequest('POST', '/api/v1/auth/login/')),
    ).toBe(true);
  });

  it('matches the OAuth callback GET routes', () => {
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

  /**
   * Every transfer POST runs under RLS. These four ran with RLS off through
   * an unanchored `path.includes('/levy-exchange/transfers')`.
   */
  it('does not bypass RLS for any levy transfer route', () => {
    for (const path of [
      '/api/v1/levy-exchange/transfers',
      `/api/v1/levy-exchange/transfers/${TRANSFER_ID}/sign`,
      `/api/v1/levy-exchange/transfers/${TRANSFER_ID}/submit`,
      `/api/v1/levy-exchange/transfers/${TRANSFER_ID}/enrolments`,
    ]) {
      expect(isRlsBootstrapRequest(makeRequest('POST', path))).toBe(false);
    }
  });

  it('does not match authenticated routes', () => {
    expect(isRlsBootstrapRequest(makeRequest('GET', '/api/v1/auth/me'))).toBe(
      false,
    );
    expect(
      isRlsBootstrapRequest(makeRequest('POST', '/api/v1/organisations')),
    ).toBe(false);
    expect(
      isRlsBootstrapRequest(makeRequest('POST', '/api/v1/enrolments')),
    ).toBe(false);
  });
});

/**
 * A rule nothing enforces is how the transfer bypass got here. Adding a route
 * to this list turns row-level security off for it; these tests make that a
 * deliberate, reviewed change rather than a line anyone can slip in.
 */
describe('RLS_BOOTSTRAP_ROUTES', () => {
  it('is exactly this list — adding a route must fail until this test is changed on purpose', () => {
    expect(RLS_BOOTSTRAP_ROUTES).toEqual({
      authPost: [
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
      ],
      authGet: [
        '/auth/oidc/callback',
        '/levy-exchange/donor-links/oauth/callback',
      ],
      platformOpsPost: ['/platform/gdpr/erasure'],
    });
  });

  const entries = Object.values(RLS_BOOTSTRAP_ROUTES).flat();

  /**
   * At least two segments, and no pattern syntax. One segment is the trap: an
   * entry of '/enrolments' would match POST /api/v1/enrolments, the ordinary
   * enrolment-creation route, as well as the transfer route it was written
   * for, and would turn row-level security off for both.
   */
  it('holds only literal route suffixes, of at least two segments', () => {
    for (const entry of entries) {
      expect(entry).toMatch(/^(\/[a-z0-9-]+){2,}$/);
    }
  });

  /**
   * A route may bypass RLS only where it has no organisation to scope by: the
   * public auth funnel, or a platform operation acting across every tenant.
   *
   * The three levy-exchange entries are neither, and predate this rule. They
   * are named here so that they stay visible, and so a fourth cannot join them
   * quietly: POST /levy-exchange/matches/search writes a waiting-pool entry and
   * POST /levy-exchange/match-applications creates an application, both with
   * row-level security off, while the OAuth callback has no session yet.
   * Reported, not changed here.
   */
  it('bypasses only auth and platform routes, plus three recorded exceptions', () => {
    const recordedExceptions = [
      '/levy-exchange/matches/search',
      '/levy-exchange/match-applications',
      '/levy-exchange/donor-links/oauth/callback',
    ];

    for (const entry of entries) {
      if (recordedExceptions.includes(entry)) continue;
      expect(entry).toMatch(/^\/(auth|invitations|platform)\//);
    }
  });

  it('anchors every entry to the end of the path', () => {
    for (const [method, list] of [
      ['POST', RLS_BOOTSTRAP_ROUTES.authPost],
      ['GET', RLS_BOOTSTRAP_ROUTES.authGet],
      ['POST', RLS_BOOTSTRAP_ROUTES.platformOpsPost],
    ] as const) {
      for (const entry of list) {
        expect(
          isRlsBootstrapRequest(makeRequest(method, `/api/v1${entry}`)),
        ).toBe(true);
        // The same text followed by anything more is a different route.
        expect(
          isRlsBootstrapRequest(makeRequest(method, `/api/v1${entry}/extra`)),
        ).toBe(false);
      }
    }
  });

  /**
   * The list is only half the rule; the other half is how it is matched. The
   * removed branch was a second matcher beside the list, so the guard is on
   * the source: endsWith is the one path test the file may contain.
   */
  it('matches paths with endsWith and nothing else', () => {
    const source = readFileSync(
      join(__dirname, 'rls-bootstrap.middleware.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

    for (const forbidden of [
      '.includes(',
      '.startsWith(',
      '.indexOf(',
      '.match(',
      '.search(',
      '.test(',
      'RegExp',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
