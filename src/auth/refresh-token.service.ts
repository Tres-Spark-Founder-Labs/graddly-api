import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidV4 } from 'uuid';

import { AuditEventService } from '../audit/audit-event.service.js';
import { AuditAction } from '../audit/enums/audit-action.enum.js';
import { RedisService } from '../redis/redis.service.js';

import { AuthErrorCode } from './auth-error-codes.js';

const REFRESH_PREFIX = 'refresh:';
const REFRESH_REVOKED_PREFIX = 'refresh-revoked:';
const USER_REFRESH_VERSION_PREFIX = 'user:';

export interface IRefreshConsumeResult {
  userId: string;
  newRefreshToken: string;
}

/**
 * Refresh tokens, their families, and the PRD §7.2 idle timeout.
 *
 * ── WHERE SESSION STATE LIVES, AND WHAT PROTECTS IT ─────────────────────────
 *
 * Redis, not Postgres. There is no refresh-token table and never has been:
 *
 *   refresh:<token>          -> "<userId>:<version>:<lastActivityMs>", TTL 7d
 *   user:<userId>:refreshVer -> the integer whose increment revokes a family
 *   refresh-revoked:<token>  -> short tombstone, for reuse detection
 *
 * So the honest statement of protection is: **not row-level security.** These
 * keys are guarded by the key namespace and by the API process holding the
 * only Redis credential. Nothing here is subject to an RLS policy, and a
 * reader with the Redis credential reads every session. That is weaker than
 * the forced policies on `push_subscriptions` and every tenant table, and it
 * is recorded rather than left to be discovered.
 *
 * A Postgres column for `lastActivityAt` was considered and rejected: it
 * would put a forced policy on a derived timestamp while the token it
 * describes stayed in Redis — protection on the less sensitive half of the
 * session — and add a write to the auth hot path plus two stores that can
 * disagree.
 *
 * **Losing the Redis key ends a session; it never extends one.** The
 * `lastActivityMs` field travels with the key that holds the token, so a
 * flushed or restarted store fails closed: the next refresh finds nothing and
 * the user signs in again — the stamp cannot outlive the token it describes.
 *
 * What does grant one fresh window is this release. A token issued before the
 * field existed carries two fields rather than three, and the constraint that
 * sessions in flight survive the deploy means such a value is read as "active
 * now" — one window, once, for sessions that already existed.
 *
 * ── WHAT "EIGHT HOURS IDLE" MEANS ───────────────────────────────────────────
 *
 * The gap between refreshes, not between requests. `lastActivityMs` moves
 * only when a refresh token is exchanged, so the granularity is the access
 * token's lifetime and the worst case is a session surviving 8h15m of true
 * inactivity. Moving it on every authenticated request would close that
 * quarter hour and cost a Redis write on every call the platform serves.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly auditEvents: AuditEventService,
  ) {}

  async issue(
    userId: string,
    lastActivityAt: number = Date.now(),
  ): Promise<string> {
    const version = await this.getCurrentVersion(userId);
    const token = uuidV4();
    const ttl = this.config.get<number>(
      'app.jwt.refreshExpiresInSeconds',
      604_800,
    );
    await this.redis.set(
      this.refreshKey(token),
      this.encodeValue(userId, version, lastActivityAt),
      ttl,
    );
    return token;
  }

  async consume(refreshToken: string): Promise<IRefreshConsumeResult> {
    const key = this.refreshKey(refreshToken);
    const raw = await this.redis.get(key);

    if (!raw) {
      const revokedUserId = await this.redis.get(this.revokedKey(refreshToken));
      if (revokedUserId) {
        await this.revokeAllForUser(revokedUserId);
        /**
         * A token presented twice is the signature of a stolen one: the
         * legitimate holder rotated it, and something else still had the old
         * value. Logging a warning meant an investigation could not see it,
         * so the revocation is recorded against the account.
         */
        await this.recordRevocation(
          revokedUserId,
          'All sessions revoked: refresh token presented twice after rotation',
        );
        this.logger.warn(
          `Refresh token reuse detected for user ${revokedUserId}`,
        );
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const decoded = this.decodeValue(raw);
    if (!decoded) {
      await this.redis.del(key);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const currentVersion = await this.getCurrentVersion(decoded.userId);
    if (decoded.version !== currentVersion) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    /**
     * PRD §7.2 — forced re-authentication after 8 hours of inactivity.
     *
     * A token with no `lastActivityMs` was issued before this existed, so it
     * is read as active now: the deploy does not sign everybody out, which is
     * the stated constraint. The family is revoked rather than only this
     * token, because the point is to end the session, and leaving siblings
     * alive would leave a way back in.
     */
    const idleLimitMs =
      this.config.get<number>('app.session.idleTimeoutSeconds', 28_800) * 1000;
    const lastActivityAt = decoded.lastActivityAt ?? Date.now();
    const idleFor = Date.now() - lastActivityAt;

    if (idleFor > idleLimitMs) {
      await this.redis.del(key);
      await this.revokeAllForUser(decoded.userId);
      await this.recordRevocation(
        decoded.userId,
        `All sessions revoked: idle for ${Math.floor(idleFor / 60_000)} minutes, ` +
          `limit ${Math.floor(idleLimitMs / 60_000)} minutes (PRD §7.2)`,
      );
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message:
          'Session ended after a period of inactivity. Please sign in again.',
        code: AuthErrorCode.SESSION_IDLE_TIMEOUT,
      });
    }

    await this.redis.del(key);
    await this.setRevokedTombstone(refreshToken, decoded.userId);

    const newRefreshToken = await this.issue(decoded.userId, Date.now());
    return { userId: decoded.userId, newRefreshToken };
  }

  async revoke(refreshToken: string): Promise<void> {
    const key = this.refreshKey(refreshToken);
    const raw = await this.redis.get(key);
    if (!raw) {
      return;
    }

    const decoded = this.decodeValue(raw);
    await this.redis.del(key);
    if (decoded) {
      await this.setRevokedTombstone(refreshToken, decoded.userId);
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.redis.incr(this.versionKey(userId));
  }

  /**
   * Records a revocation the platform decided on, against the account it
   * ended.
   *
   * ── WHY THERE IS NO ACTOR ───────────────────────────────────────────────
   *
   * Both callers run on `POST /auth/refresh`, which is unauthenticated — it
   * takes a refresh token, not a session. So `actorUserId` is null, and that
   * is the truth: nobody was signed in, something presented a token. The
   * account it happened to is the entity, which is what an investigation
   * searches by.
   *
   * Ordinary logout is deliberately not recorded, for the same reason
   * `updateLastLoginAt` is not: it is the normal end of a session rather than
   * evidence of anything, and a trail that is mostly sign-outs is harder to
   * read than one that is not.
   */
  private async recordRevocation(
    userId: string,
    detail: string,
  ): Promise<void> {
    await this.auditEvents.record({
      user: { id: null },
      action: AuditAction.UPDATE,
      entityType: 'users',
      entityId: userId,
      organisationId: null,
      detail,
    });
  }

  private async getCurrentVersion(userId: string): Promise<number> {
    const raw = await this.redis.get(this.versionKey(userId));
    if (!raw) {
      return 0;
    }
    const version = parseInt(raw, 10);
    return Number.isNaN(version) ? 0 : version;
  }

  private async setRevokedTombstone(
    refreshToken: string,
    userId: string,
  ): Promise<void> {
    const grace = this.config.get<number>('app.refresh.reuseGraceSeconds', 30);
    if (grace > 0) {
      await this.redis.set(this.revokedKey(refreshToken), userId, grace);
    }
  }

  private refreshKey(token: string): string {
    return `${REFRESH_PREFIX}${token}`;
  }

  private revokedKey(token: string): string {
    return `${REFRESH_REVOKED_PREFIX}${token}`;
  }

  private versionKey(userId: string): string {
    return `${USER_REFRESH_VERSION_PREFIX}${userId}:refreshVer`;
  }

  /**
   * `<userId>:<version>:<lastActivityMs>`.
   *
   * The activity stamp is a third field in the token's own value rather than
   * a key of its own: it is then read and written in the same round trip as
   * the token it describes, and it cannot expire out of step with it.
   */
  private encodeValue(
    userId: string,
    version: number,
    lastActivityAt: number,
  ): string {
    return `${userId}:${version}:${lastActivityAt}`;
  }

  /**
   * Reads both the two-field form written before the idle timeout existed and
   * the three-field form written since. A two-field value decodes with
   * `lastActivityAt` absent, and the caller reads that as "active now" so
   * that sessions in flight during the deploy are not ended.
   */
  private decodeValue(
    raw: string,
  ): { userId: string; version: number; lastActivityAt?: number } | null {
    const parts = raw.split(':');
    if (parts.length < 2) {
      return null;
    }

    const hasActivity = parts.length >= 3;
    const activityRaw = hasActivity ? parts[parts.length - 1] : undefined;
    const versionRaw = parts[parts.length - (hasActivity ? 2 : 1)];
    const userId = parts
      .slice(0, parts.length - (hasActivity ? 2 : 1))
      .join(':');

    const version = parseInt(versionRaw ?? '', 10);
    if (!userId || Number.isNaN(version)) {
      return null;
    }

    if (!hasActivity) {
      return { userId, version };
    }

    const lastActivityAt = parseInt(activityRaw ?? '', 10);
    return Number.isNaN(lastActivityAt)
      ? { userId, version }
      : { userId, version, lastActivityAt };
  }
}
