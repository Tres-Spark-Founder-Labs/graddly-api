import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { v4 as uuidV4 } from 'uuid';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { InvitationAcceptEmail } from '../email/payloads/invitation-accept.email.js';
import { EnrolmentProvisioningService } from '../enrolments/enrolment-provisioning.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { RedisService } from '../redis/redis.service.js';
import { User } from '../users/entities/user.entity.js';

import { Invitation } from './entities/invitation.entity.js';

import type { AcceptInvitationResultDto } from './dto/accept-invitation-result.dto.js';
import type { AcceptInvitationDto } from './dto/accept-invitation.dto.js';
import type { CreateInvitationDto } from './dto/create-invitation.dto.js';
import type { InvitationResponseDto } from './dto/invitation-response.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

const INVITATION_ACCEPT_PREFIX = 'invitation-accept:';
const INVITATION_PORTAL_PREFIX = 'invitation-portal:';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly emailDispatch: EmailDispatchService,
    @Inject(forwardRef(() => EnrolmentProvisioningService))
    private readonly enrolmentProvisioningService: EnrolmentProvisioningService,
    @InjectRepository(Invitation)
    private readonly invitationRepo: Repository<Invitation>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async accept(
    user: AuthenticatedUser,
    dto: AcceptInvitationDto,
  ): Promise<AcceptInvitationResultDto> {
    if (!user.isEmailVerified) {
      throw new ForbiddenException('Email address not verified');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const redisKey = `${INVITATION_ACCEPT_PREFIX}${dto.token}`;
    const invitationId = await this.redis.get(redisKey);
    if (!invitationId) {
      throw new UnauthorizedException('Invalid or expired invitation token');
    }

    const invitation = await this.invitationRepo.findOne({
      where: { id: invitationId },
    });
    if (!invitation || invitation.isDeleted) {
      throw new UnauthorizedException('Invalid or expired invitation token');
    }

    if (new Date() > new Date(invitation.expiresAt)) {
      throw new ForbiddenException('This invitation has expired');
    }

    if (
      invitation.email.trim().toLowerCase() !== user.email.trim().toLowerCase()
    ) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
    }

    const organisationId = invitation.organisationId;

    const existing = await this.membershipRepo.findOne({
      where: {
        user: { id: user.id },
        organisation: { id: organisationId },
        isDeleted: false,
      },
    });
    if (existing) {
      throw new ConflictException(
        'You are already a member of this organisation',
      );
    }

    const role = invitation.role;

    await this.membershipRepo.manager.transaction(async (em) => {
      const membership = em.getRepository(OrganisationMembership).create({
        user: { id: user.id },
        organisation: { id: organisationId },
        role,
      });
      await em.getRepository(OrganisationMembership).save(membership);
      invitation.isDeleted = true;
      invitation.deletedAt = new Date();
      await em.getRepository(Invitation).save(invitation);
    });

    await this.redis.del(redisKey);
    await this.deleteAllAcceptTokensForInvitation(invitationId);

    await this.enrolmentProvisioningService.onInvitationAccepted(
      invitation,
      user.id,
    );

    return { organisationId, role };
  }

  async list(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<InvitationResponseDto>> {
    const orgId = user.organisationId!;
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [rows, total] = await this.invitationRepo.findAndCount({
      where: {
        organisation: { id: orgId },
        isDeleted: false,
      },
      relations: ['invitedBy'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });
    const items = rows.map((r) => this.toResponse(r));
    return new PaginatedResult(
      items,
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateInvitationDto,
    portalType?: PortalType,
  ): Promise<InvitationResponseDto> {
    const orgId = user.organisationId!;
    await this.assertUserNotAlreadyMember(orgId, dto.email);
    await this.repairRevokedInvitationIndexBlocker(orgId, dto.email);

    const expiresAt = dto.expiresAt
      ? new Date(dto.expiresAt)
      : this.defaultExpiresAt();
    this.assertExpiresAtInFuture(expiresAt);

    const organisation = await this.organisationRepo.findOne({
      where: { id: orgId },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }

    const invitation = this.invitationRepo.create({
      email: dto.email,
      role: dto.role,
      expiresAt,
      organisation: { id: orgId },
      invitedBy: { id: user.id },
    });

    try {
      await this.invitationRepo.save(invitation);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const code = (err.driverError as { code?: string } | undefined)?.code;
        if (code === '23505') {
          throw new ConflictException(
            'An invitation already exists for this email in this organisation',
          );
        }
      }
      throw err;
    }

    const firstName = await this.resolveFirstNameForEmail(dto.email);
    await this.storeAcceptTokenAndSendEmail(
      invitation,
      organisation.name,
      firstName,
      portalType,
    );

    const reloaded = await this.invitationRepo.findOne({
      where: { id: invitation.id },
      relations: ['invitedBy'],
    });
    return this.toResponse(reloaded!);
  }

  /** Internal: apprentice portal invite tied to an enrolment activation. */
  async createForEnrolment(input: {
    actor: AuthenticatedUser;
    email: string;
    organisationId: string;
    enrolmentId: string;
    portalType: PortalType;
  }): Promise<InvitationResponseDto> {
    const { actor, email, organisationId, enrolmentId, portalType } = input;
    if (actor.organisationId !== organisationId) {
      throw new BadRequestException(
        'Enrolment apprentice invite must target the activating organisation',
      );
    }

    await this.assertUserNotAlreadyMember(
      organisationId,
      email.trim().toLowerCase(),
    );
    await this.repairRevokedInvitationIndexBlocker(organisationId, email);

    const expiresAt = this.defaultExpiresAt();
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }

    const invitation = this.invitationRepo.create({
      email: email.trim(),
      role: OrganisationRole.MEMBER,
      expiresAt,
      organisation: { id: organisationId },
      invitedBy: { id: actor.id },
      enrolmentId,
    });

    try {
      await this.invitationRepo.save(invitation);
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const code = (err.driverError as { code?: string } | undefined)?.code;
        if (code === '23505') {
          throw new ConflictException(
            'An invitation already exists for this email in this organisation',
          );
        }
      }
      throw err;
    }

    const firstName = await this.resolveFirstNameForEmail(email);
    await this.storeAcceptTokenAndSendEmail(
      invitation,
      organisation.name,
      firstName,
      portalType,
    );

    const reloaded = await this.invitationRepo.findOne({
      where: { id: invitation.id },
      relations: ['invitedBy'],
    });
    return this.toResponse(reloaded!);
  }

  async resend(
    user: AuthenticatedUser,
    invitationId: string,
    portalType?: PortalType,
  ): Promise<InvitationResponseDto> {
    const orgId = user.organisationId!;
    const invitation = await this.invitationRepo.findOne({
      where: {
        id: invitationId,
        organisation: { id: orgId },
        isDeleted: false,
      },
      relations: ['organisation', 'invitedBy'],
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (new Date() > new Date(invitation.expiresAt)) {
      throw new BadRequestException('This invitation has expired');
    }

    const organisation = invitation.organisation;
    const firstName = await this.resolveFirstNameForEmail(invitation.email);
    await this.storeAcceptTokenAndSendEmail(
      invitation,
      organisation.name,
      firstName,
      portalType,
    );

    const reloaded = await this.invitationRepo.findOne({
      where: { id: invitation.id },
      relations: ['invitedBy'],
    });
    return this.toResponse(reloaded!);
  }

  async revoke(user: AuthenticatedUser, invitationId: string): Promise<void> {
    const orgId = user.organisationId!;
    const invitation = await this.invitationRepo.findOne({
      where: {
        id: invitationId,
        organisation: { id: orgId },
        isDeleted: false,
      },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    invitation.isDeleted = true;
    invitation.deletedAt = new Date();
    await this.invitationRepo.save(invitation);
    await this.deleteAllAcceptTokensForInvitation(invitation.id);
  }

  /**
   * Older revokes used TypeORM softRemove, which set deletedAt but left
   * isDeleted=false. The partial unique index only excludes isDeleted=true,
   * so those rows still blocked re-invites for the same email.
   */
  private async repairRevokedInvitationIndexBlocker(
    organisationId: string,
    email: string,
  ): Promise<void> {
    await this.invitationRepo
      .createQueryBuilder()
      .update(Invitation)
      .set({ isDeleted: true })
      .where('"organisationId" = :organisationId', { organisationId })
      .andWhere('LOWER(email) = LOWER(:email)', { email: email.trim() })
      .andWhere('"isDeleted" = false')
      .andWhere('"deletedAt" IS NOT NULL')
      .execute();
  }

  private defaultExpiresAt(): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 14);
    return d;
  }

  private assertExpiresAtInFuture(expiresAt: Date): void {
    if (expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
  }

  private async assertUserNotAlreadyMember(
    organisationId: string,
    emailLower: string,
  ): Promise<void> {
    const row = await this.membershipRepo
      .createQueryBuilder('m')
      .innerJoin('m.user', 'u')
      .where('m.organisationId = :organisationId', { organisationId })
      .andWhere('m.isDeleted = false')
      .andWhere('LOWER(u.email) = :email', { email: emailLower })
      .getOne();
    if (row) {
      throw new ConflictException(
        'User is already a member of this organisation',
      );
    }
  }

  private async resolveFirstNameForEmail(email: string): Promise<string> {
    const u = await this.userRepo
      .createQueryBuilder('u')
      .where('LOWER(u.email) = LOWER(:e)', { e: email.trim() })
      .getOne();
    return u?.firstName?.trim() || 'there';
  }

  private resolveAcceptTokenTtlSeconds(invitationExpiresAt: Date): number {
    const cap = this.config.get<number>(
      'app.invitationAccept.tokenTtlSeconds',
      604_800,
    );
    const untilInvite = Math.ceil(
      (new Date(invitationExpiresAt).getTime() - Date.now()) / 1000,
    );
    const bounded = Math.min(cap, Math.max(1, untilInvite));
    return bounded;
  }

  private async resolvePortalTypeForInvitation(
    invitation: Invitation,
    portalType?: PortalType,
  ): Promise<PortalType | undefined> {
    if (portalType) {
      return portalType;
    }
    if (invitation.enrolmentId) {
      return PortalType.APPRENTICE;
    }
    const stored = await this.redis.get(
      `${INVITATION_PORTAL_PREFIX}${invitation.id}`,
    );
    if (stored && Object.values(PortalType).includes(stored as PortalType)) {
      return stored as PortalType;
    }
    return undefined;
  }

  private async storeAcceptTokenAndSendEmail(
    invitation: Invitation,
    organisationName: string,
    firstName: string,
    portalType?: PortalType,
  ): Promise<void> {
    const token = uuidV4();
    const ttl = this.resolveAcceptTokenTtlSeconds(invitation.expiresAt);
    const effectivePortal = await this.resolvePortalTypeForInvitation(
      invitation,
      portalType,
    );

    await this.redis.set(
      `${INVITATION_ACCEPT_PREFIX}${token}`,
      invitation.id,
      ttl,
    );

    if (effectivePortal) {
      await this.redis.set(
        `${INVITATION_PORTAL_PREFIX}${invitation.id}`,
        effectivePortal,
        ttl,
      );
    }

    try {
      const payload = InvitationAcceptEmail.create(this.config, {
        to: invitation.email,
        firstName,
        token,
        organisationName,
        portalType: effectivePortal,
        tokenTtlSeconds: ttl,
      });

      if (this.config.get<string>('app.nodeEnv') === 'development') {
        const { acceptUrl } = payload.getTemplateContext() as {
          acceptUrl: string;
        };
        this.logger.log(
          `Invitation accept link (dev, ${invitation.email}): ${acceptUrl}`,
        );
      }

      await this.emailDispatch.enqueue(payload);
    } catch (err) {
      this.logger.error(
        `Invitation email failed for ${invitation.email}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async deleteAllAcceptTokensForInvitation(
    invitationId: string,
  ): Promise<void> {
    const client = this.redis.getClient();
    let cursor = '0';
    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        'MATCH',
        `${INVITATION_ACCEPT_PREFIX}*`,
        'COUNT',
        50,
      );
      cursor = nextCursor;
      for (const key of keys) {
        const v = await client.get(key);
        if (v === invitationId) {
          await client.del(key);
        }
      }
    } while (cursor !== '0');
  }

  private toResponse(invitation: Invitation): InvitationResponseDto {
    const invitedBy = invitation.invitedBy
      ? {
          id: invitation.invitedBy.id,
          firstName: invitation.invitedBy.firstName,
          lastName: invitation.invitedBy.lastName,
          email: invitation.invitedBy.email,
        }
      : null;
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      updatedAt: invitation.updatedAt.toISOString(),
      invitedBy,
    };
  }
}
