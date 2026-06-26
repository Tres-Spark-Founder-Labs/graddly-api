import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { v4 as uuidV4 } from 'uuid';

import {
  setCurrentUserId,
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import {
  clearLastKnownUserIdForGuc,
  setLastKnownUserIdForGuc,
} from '../database/apply-tenant-gucs.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailVerificationEmail } from '../email/payloads/email-verification.email.js';
import { PasswordResetEmail } from '../email/payloads/password-reset.email.js';
import { OrganisationListItemDto } from '../organisations/dto/organisation-list-item.dto.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { MembershipStatus } from '../organisations/membership-status.enum.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { RedisService } from '../redis/redis.service.js';
import { User } from '../users/entities/user.entity.js';
import { UsersService } from '../users/users.service.js';

import { ActiveOrganisationMeDto } from './dto/active-organisation-context.dto.js';
import { AuthResponseDto } from './dto/auth-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { IJwtPayload } from './interfaces/jwt-payload.interface.js';
import { RefreshTokenService } from './refresh-token.service.js';

const PASSWORD_RESET_PREFIX = 'password-reset:';
const EMAIL_VERIFY_PREFIX = 'email-verify:';

/** Lower is higher privilege when choosing the active organisation. */
const ROLE_PRIORITY: Record<OrganisationRole, number> = {
  [OrganisationRole.OWNER]: 0,
  [OrganisationRole.ADMIN]: 1,
  [OrganisationRole.MEMBER]: 2,
};

type MembershipRow = {
  mRole: string;
  mStatus: string;
  oId: string;
  oName: string;
  oSlug: string;
  oType: string | null;
  oPortalType: string | null;
  oUkprn: string | null;
  oAddress: string | null;
  oCity: string | null;
  oPostcode: string | null;
  oCountry: string | null;
  oOrgEmail: string | null;
  oOrgPhone: string | null;
  oWebsite: string | null;
  oLogoUrl: string | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly emailDispatch: EmailDispatchService,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
  ) {}

  async signup(dto: SignupDto, portalType?: PortalType): Promise<void> {
    const user = await this.usersService.create(dto);
    await this.sendVerificationEmail(user, portalType);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      throw new ForbiddenException('Email address not verified');
    }

    void this.usersService.updateLastLoginAt(user.id).catch(() => undefined);

    return this.generateTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const { userId, newRefreshToken } =
      await this.refreshTokenService.consume(refreshToken);

    const user = await this.usersService.findById(userId);
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }
    if (!user.isEmailVerified) {
      throw new ForbiddenException('Email address not verified');
    }

    return this.generateTokens(user, newRefreshToken);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokenService.revoke(refreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenService.revokeAllForUser(userId);
  }

  /** Always completes; does not reveal whether the email exists. */
  async requestPasswordReset(
    email: string,
    portalType?: PortalType,
  ): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user?.isActive) {
      return;
    }

    const token = uuidV4();
    const ttl = this.config.get<number>(
      'app.passwordReset.tokenTtlSeconds',
      3600,
    );
    await this.redis.set(`${PASSWORD_RESET_PREFIX}${token}`, user.id, ttl);

    try {
      await this.emailDispatch.enqueue(
        PasswordResetEmail.create(this.config, {
          to: user.email,
          firstName: user.firstName,
          token,
          portalType,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Password reset email failed for ${user.email}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async resetPassword(
    token: string,
    password: string,
  ): Promise<AuthResponseDto> {
    const userId = await this.redis.get(`${PASSWORD_RESET_PREFIX}${token}`);
    if (!userId) {
      throw new UnauthorizedException(
        'Invalid or expired password reset token',
      );
    }

    await this.redis.del(`${PASSWORD_RESET_PREFIX}${token}`);
    await this.usersService.updatePassword(userId, password);
    await this.refreshTokenService.revokeAllForUser(userId);

    const user = await this.usersService.findById(userId);
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    return this.generateTokens(user);
  }

  async verifyEmail(token: string): Promise<AuthResponseDto> {
    const userId = await this.redis.get(`${EMAIL_VERIFY_PREFIX}${token}`);
    if (!userId) {
      throw new UnauthorizedException(
        'Invalid or expired email verification token',
      );
    }

    await this.redis.del(`${EMAIL_VERIFY_PREFIX}${token}`);

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    clearLastKnownUserIdForGuc();
    try {
      await this.usersService.markEmailVerified(userId);

      const user = await this.usersService.findById(userId);
      if (!user.isActive) {
        throw new UnauthorizedException('Account is deactivated');
      }

      return this.generateTokens(user);
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  /** Always completes; does not reveal whether the email exists. */
  async resendVerification(
    email: string,
    portalType?: PortalType,
  ): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user?.isActive || user.isEmailVerified) {
      return;
    }

    await this.sendVerificationEmail(user, portalType);
  }

  /** Issue JWT pair for an existing user (e.g. after OIDC callback). */
  async issueTokensForUser(user: User): Promise<AuthResponseDto> {
    return this.generateTokens(user);
  }

  /**
   * Resolves the active organisation for a user scoped strictly to the given portalType.
   * Returns null when no active membership exists for that portal. Single round-trip, no N+1.
   * getRawOne() is intentional: innerJoinAndSelect + select() leaves the relation unhydrated in TypeORM.
   */
  /**
   * SQL `CASE` expression ordering memberships by role priority
   * (owner > admin > member). Shared by the active-org and organisations-list
   * resolvers so "first recent org" means the same thing everywhere.
   */
  private readonly membershipRoleOrder =
    `CASE m.role` +
    ` WHEN '${OrganisationRole.OWNER}' THEN 0` +
    ` WHEN '${OrganisationRole.ADMIN}' THEN 1` +
    ` WHEN '${OrganisationRole.MEMBER}' THEN 2 ELSE 3 END`;

  /**
   * Resolves the active organisation for `/me`, driven by the optional
   * `X-Organisation-Id` value supplied by the caller:
   *
   * - `organisationId` omitted/blank → the user's first recent active org
   *   (role priority owner > admin > member, then earliest join date). Returns
   *   `null` when the user has no active membership.
   * - `organisationId` provided and the user is an active member → that org.
   * - `organisationId` provided but the user is not an active member →
   *   `ForbiddenException` (403).
   *
   * A malformed (non-UUID) `X-Organisation-Id` never reaches this method: the
   * controller short-circuits and returns `null` for those.
   */
  async resolveActiveOrganisationForUser(
    userId: string,
    organisationId?: string,
  ): Promise<ActiveOrganisationMeDto | null> {
    const qb = this.membershipRepo
      .createQueryBuilder('m')
      .innerJoin('m.organisation', 'o')
      .select('m.role', 'mRole')
      .addSelect('m.status', 'mStatus')
      .addSelect('o.id', 'oId')
      .addSelect('o.name', 'oName')
      .addSelect('o.slug', 'oSlug')
      .addSelect('o.type', 'oType')
      .addSelect('o.portalType', 'oPortalType')
      .addSelect('o.ukprn', 'oUkprn')
      .addSelect('o.address', 'oAddress')
      .addSelect('o.city', 'oCity')
      .addSelect('o.postcode', 'oPostcode')
      .addSelect('o.country', 'oCountry')
      .addSelect('o.orgEmail', 'oOrgEmail')
      .addSelect('o.orgPhone', 'oOrgPhone')
      .addSelect('o.website', 'oWebsite')
      .addSelect('o.logoUrl', 'oLogoUrl')
      .where('m."userId" = :userId', { userId })
      .andWhere('m.status = :status', { status: MembershipStatus.ACTIVE });

    if (organisationId) {
      qb.andWhere('o.id = :organisationId', { organisationId });
    }

    const row = await qb
      .orderBy(this.membershipRoleOrder, 'ASC')
      .addOrderBy('m.joinedAt', 'ASC')
      .limit(1)
      .getRawOne<MembershipRow>();

    if (!row) {
      // A specific org was requested but the user is not an active member.
      if (organisationId) {
        throw new ForbiddenException(
          'You are not a member of this organisation',
        );
      }
      // No org requested and the user has no active membership.
      return null;
    }

    return {
      roles: [row.mRole],
      membershipStatus: row.mStatus as MembershipStatus,
      organisation: {
        id: row.oId,
        name: row.oName,
        slug: row.oSlug,
        type: row.oType ?? null,
        portalType: (row.oPortalType as PortalType) ?? null,
        ukprn: row.oUkprn ?? null,
        address: row.oAddress ?? null,
        city: row.oCity ?? null,
        postcode: row.oPostcode ?? null,
        country: row.oCountry ?? null,
        orgEmail: row.oOrgEmail ?? null,
        orgPhone: row.oOrgPhone ?? null,
        website: row.oWebsite ?? null,
        logoUrl: row.oLogoUrl ?? null,
      },
    };
  }

  /**
   * Lightweight list of every active organisation the user belongs to, ordered
   * by role priority then join date. Carries only the fields a client needs to
   * render an org switcher: id, name, portalType, slug.
   */
  async resolveOrganisationsForUser(
    userId: string,
  ): Promise<OrganisationListItemDto[]> {
    const rows = await this.membershipRepo
      .createQueryBuilder('m')
      .innerJoin('m.organisation', 'o')
      .select('o.id', 'oId')
      .addSelect('o.name', 'oName')
      .addSelect('o.portalType', 'oPortalType')
      .addSelect('o.slug', 'oSlug')
      .where('m."userId" = :userId', { userId })
      .andWhere('m.status = :status', { status: MembershipStatus.ACTIVE })
      .orderBy(this.membershipRoleOrder, 'ASC')
      .addOrderBy('m.joinedAt', 'ASC')
      .getRawMany<
        Pick<MembershipRow, 'oId' | 'oName' | 'oPortalType' | 'oSlug'>
      >();

    return rows.map((row) => ({
      id: row.oId,
      name: row.oName,
      portalType: (row.oPortalType as PortalType) ?? null,
      slug: row.oSlug,
    }));
  }

  private async sendVerificationEmail(
    user: User,
    portalType?: PortalType,
  ): Promise<void> {
    if (user.isEmailVerified) {
      return;
    }

    const token = uuidV4();
    const ttl = this.config.get<number>(
      'app.emailVerification.tokenTtlSeconds',
      86_400,
    );
    await this.redis.set(`${EMAIL_VERIFY_PREFIX}${token}`, user.id, ttl);

    try {
      const payload = EmailVerificationEmail.create(this.config, {
        to: user.email,
        firstName: user.firstName,
        token,
        portalType,
      });

      if (this.config.get<string>('app.nodeEnv') === 'development') {
        const { verifyUrl } = payload.getTemplateContext() as {
          verifyUrl: string;
        };
        this.logger.log(
          `Email verification link (dev, ${user.email}): ${verifyUrl}`,
        );
      }

      await this.emailDispatch.enqueue(payload);
    } catch (err) {
      this.logger.error(
        `Email verification failed for ${user.email}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /**
   * Active organisation: lowest role priority wins (OWNER, then ADMIN, then MEMBER),
   * with earliest membership createdAt as tiebreaker.
   * Used only for JWT generation; loads minimal data with no portal scoping.
   */
  private async resolveActiveMembershipForUser(
    userId: string,
  ): Promise<OrganisationMembership | null> {
    const memberships = await this.membershipRepo.find({
      where: { user: { id: userId } },
      relations: ['organisation'],
    });

    if (memberships.length === 0) {
      return null;
    }

    const sorted = [...memberships].sort((a, b) => {
      const pa = ROLE_PRIORITY[a.role];
      const pb = ROLE_PRIORITY[b.role];
      if (pa !== pb) {
        return pa - pb;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return sorted[0] ?? null;
  }

  private async generateTokens(
    user: User,
    existingRefreshToken?: string,
  ): Promise<AuthResponseDto> {
    setCurrentUserId(user.id);
    setLastKnownUserIdForGuc(user.id);

    const membership = await this.resolveActiveMembershipForUser(user.id);

    const jwtPayload: IJwtPayload = {
      sub: user.id,
      email: user.email,
      ...(membership?.organisation
        ? {
            orgId: membership.organisation.id,
            roles: [membership.role],
          }
        : {}),
    };

    const accessTtl = this.config.get<number>(
      'app.jwt.accessExpiresInSeconds',
      900,
    );
    const accessToken = this.jwtService.sign(jwtPayload, {
      expiresIn: accessTtl,
    });

    const refreshToken =
      existingRefreshToken ?? (await this.refreshTokenService.issue(user.id));

    return { accessToken, refreshToken };
  }
}
