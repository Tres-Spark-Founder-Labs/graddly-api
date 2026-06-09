import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildPaginationMeta } from '../../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../../common/pagination/paginated-result.js';
import { NotificationType } from '../../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { OrganisationMembership } from '../../organisations/entities/organisation-membership.entity.js';
import { MembershipStatus } from '../../organisations/membership-status.enum.js';
import { OrganisationRole } from '../../organisations/organisation-role.enum.js';
import { CreateMatchApplicationDto } from '../dto/create-match-application.dto.js';
import {
  ListMatchApplicationsQueryDto,
  MatchApplicationRoleFilter,
} from '../dto/list-match-applications-query.dto.js';
import { MatchApplicationResponseDto } from '../dto/match-application-response.dto.js';
import { UpdateMatchApplicationDto } from '../dto/update-match-application.dto.js';
import { LevyMatchApplication } from '../entities/levy-match-application.entity.js';
import { LevyMatchApplicationStatus } from '../enums/levy-match-application-status.enum.js';

import { LevyTransferPreferenceService } from './levy-transfer-preference.service.js';

import type { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class LevyMatchApplicationService {
  constructor(
    @InjectRepository(LevyMatchApplication)
    private readonly applicationRepo: Repository<LevyMatchApplication>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    private readonly transferPreferenceService: LevyTransferPreferenceService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateMatchApplicationDto,
  ): Promise<MatchApplicationResponseDto> {
    const recipientOrganisationId = user.organisationId!;
    if (recipientOrganisationId === dto.donorOrganisationId) {
      throw new BadRequestException(
        'Recipient and donor organisations must differ',
      );
    }

    const donorPreferences =
      await this.transferPreferenceService.getEntityOrThrow(
        dto.donorOrganisationId,
      );
    const status = donorPreferences.openMatching
      ? LevyMatchApplicationStatus.CONFIRMED
      : LevyMatchApplicationStatus.PENDING;

    const application = this.applicationRepo.create({
      donorOrganisationId: dto.donorOrganisationId,
      recipientOrganisationId,
      requestedAmount: dto.requestedAmount,
      status,
      matchScore: dto.matchScore ?? null,
      scoreBreakdown:
        (dto.scoreBreakdown as Record<string, unknown> | undefined) ?? null,
    });
    const saved = await this.applicationRepo.save(application);

    if (status === LevyMatchApplicationStatus.CONFIRMED) {
      await this.notifyParties(
        saved,
        'Levy match confirmed',
        'A levy transfer match has been automatically confirmed.',
      );
    } else {
      await this.notifyOrganisationAdmins(
        dto.donorOrganisationId,
        NotificationType.GENERIC,
        'New levy match application',
        'An SME has submitted a levy transfer application for your review.',
        { matchApplicationId: saved.id },
      );
      await this.notifyOrganisationAdmins(
        recipientOrganisationId,
        NotificationType.GENERIC,
        'Levy match application submitted',
        'Your levy transfer application has been sent to the donor for review.',
        { matchApplicationId: saved.id },
      );
    }

    return this.toResponse(saved);
  }

  async list(
    organisationId: string,
    query: ListMatchApplicationsQueryDto,
  ): Promise<PaginatedResult<MatchApplicationResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const qb = this.applicationRepo
      .createQueryBuilder('application')
      .where('application.isDeleted = false');

    if (query.role === MatchApplicationRoleFilter.DONOR) {
      qb.andWhere('application.donorOrganisationId = :organisationId', {
        organisationId,
      });
    } else if (query.role === MatchApplicationRoleFilter.RECIPIENT) {
      qb.andWhere('application.recipientOrganisationId = :organisationId', {
        organisationId,
      });
    } else {
      qb.andWhere(
        '(application.donorOrganisationId = :organisationId OR application.recipientOrganisationId = :organisationId)',
        { organisationId },
      );
    }

    if (query.status) {
      qb.andWhere('application.status = :status', { status: query.status });
    }

    qb.orderBy('application.createdAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await qb.getManyAndCount();
    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async updateStatus(
    user: AuthenticatedUser,
    applicationId: string,
    dto: UpdateMatchApplicationDto,
  ): Promise<MatchApplicationResponseDto> {
    const organisationId = user.organisationId!;
    const application = await this.applicationRepo.findOne({
      where: { id: applicationId, isDeleted: false },
    });
    if (!application) {
      throw new NotFoundException('Match application not found');
    }
    if (application.donorOrganisationId !== organisationId) {
      throw new ForbiddenException(
        'Only the donor organisation can confirm or reject applications',
      );
    }
    if (application.status !== LevyMatchApplicationStatus.PENDING) {
      throw new BadRequestException('Only pending applications can be updated');
    }

    application.status = dto.status;
    const saved = await this.applicationRepo.save(application);

    if (dto.status === LevyMatchApplicationStatus.CONFIRMED) {
      await this.notifyParties(
        saved,
        'Levy match confirmed',
        'A levy transfer match has been confirmed by the donor.',
      );
    } else {
      await this.notifyOrganisationAdmins(
        application.recipientOrganisationId,
        NotificationType.GENERIC,
        'Levy match application rejected',
        'Your levy transfer application was rejected by the donor.',
        { matchApplicationId: saved.id },
      );
      await this.notifyOrganisationAdmins(
        organisationId,
        NotificationType.GENERIC,
        'Levy match application rejected',
        'You rejected a levy transfer application.',
        { matchApplicationId: saved.id },
      );
    }

    return this.toResponse(saved);
  }

  private async notifyParties(
    application: LevyMatchApplication,
    title: string,
    body: string,
  ): Promise<void> {
    await this.notifyOrganisationAdmins(
      application.donorOrganisationId,
      NotificationType.GENERIC,
      title,
      body,
      { matchApplicationId: application.id },
    );
    await this.notifyOrganisationAdmins(
      application.recipientOrganisationId,
      NotificationType.GENERIC,
      title,
      body,
      { matchApplicationId: application.id },
    );
  }

  private async notifyOrganisationAdmins(
    organisationId: string,
    type: NotificationType,
    title: string,
    body: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const memberships = await this.membershipRepo.find({
      where: {
        organisation: { id: organisationId },
        isDeleted: false,
        status: MembershipStatus.ACTIVE,
        role: OrganisationRole.OWNER,
      },
      relations: ['user'],
    });
    const admins = await this.membershipRepo.find({
      where: {
        organisation: { id: organisationId },
        isDeleted: false,
        status: MembershipStatus.ACTIVE,
        role: OrganisationRole.ADMIN,
      },
      relations: ['user'],
    });

    const recipients = [...memberships, ...admins];
    const notified = new Set<string>();
    for (const membership of recipients) {
      const userId = membership.user.id;
      if (notified.has(userId)) {
        continue;
      }
      notified.add(userId);
      await this.notificationsService.createForUser({
        userId,
        organisationId,
        type,
        title,
        body,
        metadata,
      });
    }
  }

  private toResponse(
    application: LevyMatchApplication,
  ): MatchApplicationResponseDto {
    return {
      id: application.id,
      donorOrganisationId: application.donorOrganisationId,
      recipientOrganisationId: application.recipientOrganisationId,
      requestedAmount: application.requestedAmount,
      status: application.status,
      matchScore: application.matchScore,
      scoreBreakdown: application.scoreBreakdown,
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    };
  }
}
