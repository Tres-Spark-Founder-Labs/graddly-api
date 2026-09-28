import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { AuditEventService } from '../audit/audit-event.service.js';
import { RedisService } from '../redis/redis.service.js';

import { RefreshTokenService } from './refresh-token.service.js';

const USER_ID = 'user-uuid-1';
const IDLE_TIMEOUT_SECONDS = 28_800;

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;

  const store = new Map<string, { value: string; ttl?: number }>();
  const versionCounters = new Map<string, number>();

  const mockRedis = {
    get: jest.fn((key: string) => store.get(key)?.value ?? null),
    set: jest.fn((key: string, value: string, ttl?: number) => {
      store.set(key, { value, ttl });
    }),
    del: jest.fn((key: string) => {
      store.delete(key);
    }),
    incr: jest.fn((key: string) => {
      const next = (versionCounters.get(key) ?? 0) + 1;
      versionCounters.set(key, next);
      store.set(key, { value: String(next) });
      return next;
    }),
  };

  const mockConfig = {
    get: jest.fn((key: string, fallback?: unknown) => {
      const values = new Map<string, unknown>([
        ['app.jwt.refreshExpiresInSeconds', 604_800],
        ['app.refresh.reuseGraceSeconds', 30],
        ['app.session.idleTimeoutSeconds', IDLE_TIMEOUT_SECONDS],
      ]);
      return values.get(key) ?? fallback;
    }),
  };

  const record = jest.fn();

  /** Re-stamps a stored token's activity field, as an idle session would be. */
  const ageSession = (token: string, secondsIdle: number): void => {
    const entry = store.get(`refresh:${token}`);
    const [userId, version] = (entry?.value ?? '').split(':');
    store.set(`refresh:${token}`, {
      value: `${userId}:${version}:${Date.now() - secondsIdle * 1000}`,
      ttl: entry?.ttl,
    });
  };

  beforeEach(async () => {
    store.clear();
    versionCounters.clear();
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefreshTokenService,
        { provide: RedisService, useValue: mockRedis },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditEventService, useValue: { record } },
      ],
    }).compile();

    service = module.get(RefreshTokenService);
  });

  it('issues a versioned refresh token', async () => {
    const token = await service.issue(USER_ID);

    expect(token).toEqual(expect.any(String));
    // userId:version:lastActivityMs — the activity stamp rides with the token
    // it describes, so the two cannot expire out of step.
    const [userId, version, lastActivity] = (
      store.get(`refresh:${token}`)?.value ?? ''
    ).split(':');
    expect(userId).toBe(USER_ID);
    expect(version).toBe('0');
    expect(Number(lastActivity)).toBeGreaterThan(Date.now() - 5_000);
  });

  it('rotates a valid refresh token and stores a tombstone', async () => {
    const oldToken = await service.issue(USER_ID);

    const result = await service.consume(oldToken);

    expect(result.userId).toBe(USER_ID);
    expect(result.newRefreshToken).not.toBe(oldToken);
    expect(store.has(`refresh:${oldToken}`)).toBe(false);
    expect(store.get(`refresh-revoked:${oldToken}`)?.value).toBe(USER_ID);
  });

  it('detects reuse via tombstone and invalidates other device tokens', async () => {
    const tokenA = await service.issue(USER_ID);
    const tokenB = await service.issue(USER_ID);
    await service.consume(tokenA);

    await expect(service.consume(tokenA)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(versionCounters.get(`user:${USER_ID}:refreshVer`)).toBe(1);

    await expect(service.consume(tokenB)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('revokeAllForUser invalidates outstanding tokens by version', async () => {
    const token = await service.issue(USER_ID);
    await service.revokeAllForUser(USER_ID);

    await expect(service.consume(token)).rejects.toThrow(UnauthorizedException);
  });

  it('revoke removes active token and sets tombstone', async () => {
    const token = await service.issue(USER_ID);
    await service.revoke(token);

    expect(store.has(`refresh:${token}`)).toBe(false);
    expect(store.get(`refresh-revoked:${token}`)?.value).toBe(USER_ID);
  });

  /** PRD §7.2 — "forced re-authentication after 8 hours of inactivity". */
  describe('idle timeout', () => {
    it('refreshes normally one second inside the window, and moves the stamp', async () => {
      const token = await service.issue(USER_ID);
      ageSession(token, IDLE_TIMEOUT_SECONDS - 1);

      const result = await service.consume(token);

      const stamp = Number(
        (store.get(`refresh:${result.newRefreshToken}`)?.value ?? '').split(
          ':',
        )[2],
      );
      expect(stamp).toBeGreaterThan(Date.now() - 5_000);
    });

    it('refuses one second outside it, and revokes the whole family', async () => {
      const idle = await service.issue(USER_ID);
      const sibling = await service.issue(USER_ID);
      ageSession(idle, IDLE_TIMEOUT_SECONDS + 1);

      await expect(service.consume(idle)).rejects.toThrow(
        UnauthorizedException,
      );

      // The other device goes with it: ending the session means ending it.
      expect(versionCounters.get(`user:${USER_ID}:refreshVer`)).toBe(1);
      await expect(service.consume(sibling)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('carries a code the client can tell apart from an ordinary expiry', async () => {
      const token = await service.issue(USER_ID);
      ageSession(token, IDLE_TIMEOUT_SECONDS + 1);

      await expect(service.consume(token)).rejects.toMatchObject({
        response: { code: 'SESSION_IDLE_TIMEOUT' },
      });
    });

    it('records the revocation against the account, with no actor', async () => {
      const token = await service.issue(USER_ID);
      ageSession(token, IDLE_TIMEOUT_SECONDS + 1);

      await expect(service.consume(token)).rejects.toThrow();

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'users',
          entityId: USER_ID,
          // Refresh is unauthenticated: a token was presented, nobody was
          // signed in, and claiming an actor would be a guess.
          user: { id: null },
          organisationId: null,
        }),
      );
      const [call] = record.mock.calls.at(-1) as [{ detail: string }];
      expect(call.detail).toContain('idle');
    });

    it('records the reuse revocation too, which only logged a warning before', async () => {
      const token = await service.issue(USER_ID);
      await service.consume(token);
      record.mockClear();

      await expect(service.consume(token)).rejects.toThrow(
        UnauthorizedException,
      );

      const [call] = record.mock.calls.at(-1) as [{ detail: string }];
      expect(call.detail).toContain('presented twice');
    });

    /**
     * The deploy constraint: a session in flight when this shipped has a
     * two-field value and must not be signed out for it.
     */
    it('treats a token issued before the timeout existed as active now', async () => {
      const token = await service.issue(USER_ID);
      store.set(`refresh:${token}`, { value: `${USER_ID}:0` });

      await expect(service.consume(token)).resolves.toMatchObject({
        userId: USER_ID,
      });
    });
  });
});
