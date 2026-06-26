import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { CompletionPushService } from '../completion-push/completion-push.service.js';
import { MessageThreadsService } from '../messaging/message-threads.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { MembershipStatus } from '../organisations/membership-status.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { User } from '../users/entities/user.entity.js';
import { WithdrawalPushService } from '../withdrawal-push/withdrawal-push.service.js';

import { CounterpartOrganisationLookupResponseDto } from './dto/counterpart-organisation-lookup-response.dto.js';
import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { EnrolmentParticipantOptionsResponseDto } from './dto/enrolment-participant-options-response.dto.js';
import { EpaOutcomeResponseDto } from './dto/epa-outcome-response.dto.js';
import { LookupCounterpartOrganisationQueryDto } from './dto/lookup-counterpart-organisation-query.dto.js';
import { ParticipantUserOptionDto } from './dto/participant-user-option.dto.js';
import { RecordEpaOutcomeDto } from './dto/record-epa-outcome.dto.js';
import { UpdateEnrolmentOrganisationLinksDto } from './dto/update-enrolment-organisation-links.dto.js';
import { UpdateEnrolmentParticipantsDto } from './dto/update-enrolment-participants.dto.js';
import { EnrolmentPipelineService } from './enrolment-pipeline.service.js';
import {
  buildEnrolmentListWhere,
  resolveEnrolmentPortalType,
} from './enrolment-portal-scope.util.js';
import { EnrolmentProvisioningService } from './enrolment-provisioning.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EpaOutcomeRecord } from './entities/epa-outcome.entity.js';
import { EnrolmentPipelineState } from './enums/enrolment-pipeline-state.enum.js';
import { EnrolmentStatus } from './enums/enrolment-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

export type EnrolmentWithOrganisationLinkLabels = Enrolment & {
  employerOrganisationName: string | null;
  providerOrganisationName: string | null;
};

export type EnrolmentWithDisplayLabels = EnrolmentWithOrganisationLinkLabels & {
  apprenticeDisplayName: string | null;
  standardDisplayName: string | null;
  apprenticeUserDisplayName: string | null;
  tutorUserDisplayName: string | null;
  employerManagerUserDisplayName: string | null;
};

@Injectable()
export class EnrolmentsService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Apprentice)
    private readonly apprenticeRepo: Repository<Apprentice>,
    @InjectRepository(Standard)
    private readonly standardRepo: Repository<Standard>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(EpaOutcomeRecord)
    private readonly epaOutcomeRepo: Repository<EpaOutcomeRecord>,
    private readonly withdrawalPushService: WithdrawalPushService,
    private readonly completionPushService: CompletionPushService,
    private readonly pipelineService: EnrolmentPipelineService,
    private readonly provisioningService: EnrolmentProvisioningService,
    @Inject(forwardRef(() => MessageThreadsService))
    private readonly messageThreadsService: MessageThreadsService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateEnrolmentDto,
  ): Promise<Enrolment> {
    const organisationId = user.organisationId!;
    await this.assertInOrganisation(
      organisationId,
      dto.apprenticeId,
      dto.standardId,
    );

    const existing = await this.enrolmentRepo.findOne({
      where: {
        organisationId,
        apprenticeId: dto.apprenticeId,
        standardId: dto.standardId,
      },
      order: { createdAt: 'DESC' },
    });

    if (
      existing &&
      !existing.isDeleted &&
      (existing.status === EnrolmentStatus.DRAFT ||
        existing.status === EnrolmentStatus.ACTIVE)
    ) {
      throw new ConflictException(
        'An active or draft enrolment already exists for this apprentice and standard',
      );
    }

    const enrolment = this.enrolmentRepo.create({
      organisationId,
      apprenticeId: dto.apprenticeId,
      standardId: dto.standardId,
      status: EnrolmentStatus.DRAFT,
      agreedPrice:
        dto.agreedPrice !== undefined ? String(dto.agreedPrice) : null,
      plannedStartDate: dto.plannedStartDate ?? null,
      plannedEndDate: dto.plannedEndDate ?? null,
      completionPaymentPercent:
        dto.completionPaymentPercent !== undefined
          ? String(dto.completionPaymentPercent)
          : null,
    });
    if (dto.plannedStartDate && dto.plannedEndDate) {
      const start = new Date(dto.plannedStartDate);
      const end = new Date(dto.plannedEndDate);
      const months =
        (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        (end.getUTCMonth() - start.getUTCMonth());
      enrolment.plannedDurationMonths = Math.max(months, 1);
    }

    return this.enrolmentRepo.save(enrolment);
  }

  async findAll(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
    portalType?: PortalType,
  ): Promise<PaginatedResult<EnrolmentWithDisplayLabels>> {
    const resolvedPortal = await this.resolvePortalType(user, portalType);
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await this.enrolmentRepo.findAndCount({
      where: buildEnrolmentListWhere(user, resolvedPortal),
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    const enriched = await this.enrichEnrolmentsForDisplay(items);

    return new PaginatedResult(
      enriched,
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
    portalType?: PortalType,
  ): Promise<EnrolmentWithDisplayLabels> {
    if (portalType) {
      return this.enrichEnrolmentForDisplay(
        await this.findOneScoped(user, id, portalType),
      );
    }

    for (const scope of [
      PortalType.PROVIDER,
      PortalType.FLOW,
      PortalType.EMPLOYER,
      PortalType.APPRENTICE,
    ]) {
      const enrolment = await this.enrolmentRepo.findOne({
        where: { ...buildEnrolmentListWhere(user, scope), id },
      });
      if (enrolment) {
        return this.enrichEnrolmentForDisplay(enrolment);
      }
    }

    throw new NotFoundException('Enrolment not found');
  }

  private async findOneScoped(
    user: AuthenticatedUser,
    id: string,
    portalType: PortalType,
  ): Promise<Enrolment> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { ...buildEnrolmentListWhere(user, portalType), id },
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }
    return enrolment;
  }

  private async resolvePortalType(
    user: AuthenticatedUser,
    headerPortalType?: PortalType,
  ): Promise<PortalType> {
    if (headerPortalType) {
      return headerPortalType;
    }

    const organisation = await this.organisationRepo.findOne({
      where: { id: user.organisationId!, isDeleted: false },
    });

    return resolveEnrolmentPortalType(undefined, organisation?.portalType);
  }

  async updateParticipants(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateEnrolmentParticipantsDto,
  ): Promise<EnrolmentWithDisplayLabels> {
    const enrolment = await this.findOneEntity(user, id);
    if (dto.apprenticeUserId !== undefined) {
      enrolment.apprenticeUserId = dto.apprenticeUserId;
    }
    if (dto.tutorUserId !== undefined) {
      enrolment.tutorUserId = dto.tutorUserId;
    }
    if (dto.employerManagerUserId !== undefined) {
      enrolment.employerManagerUserId = dto.employerManagerUserId;
    }
    return this.enrichEnrolmentForDisplay(
      await this.enrolmentRepo.save(enrolment),
    );
  }

  async getParticipantOptions(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<EnrolmentParticipantOptionsResponseDto> {
    await this.assertProviderPortal(user.organisationId!);

    const enrolment = await this.enrolmentRepo.findOne({
      where: {
        id: enrolmentId,
        organisationId: user.organisationId!,
        isDeleted: false,
      },
      relations: ['apprentice'],
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }

    const [apprenticeCandidates, tutors, employerManagers] = await Promise.all([
      this.loadApprenticeUserCandidates(enrolment),
      this.loadOrgMemberOptions(user.organisationId!),
      enrolment.employerOrganisationId
        ? this.loadOrgMemberOptions(enrolment.employerOrganisationId)
        : Promise.resolve([]),
    ]);

    return { apprenticeCandidates, tutors, employerManagers };
  }

  async lookupCounterpartOrganisationByUkprn(
    user: AuthenticatedUser,
    query: LookupCounterpartOrganisationQueryDto,
  ): Promise<CounterpartOrganisationLookupResponseDto> {
    await this.assertProviderPortal(user.organisationId!);

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const organisation = await this.organisationRepo.findOne({
        where: {
          ukprn: query.ukprn,
          portalType: PortalType.EMPLOYER,
          isDeleted: false,
        },
      });
      if (!organisation?.ukprn) {
        throw new NotFoundException(
          'No employer organisation found for this UKPRN',
        );
      }

      return {
        id: organisation.id,
        name: organisation.name,
        ukprn: organisation.ukprn,
        portalType: organisation.portalType as PortalType,
      };
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  async updateOrganisationLinks(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateEnrolmentOrganisationLinksDto,
  ): Promise<EnrolmentWithDisplayLabels> {
    const enrolment = await this.findOneEntity(user, id);

    if (dto.employerOrganisationId !== undefined) {
      if (dto.employerOrganisationId) {
        await this.assertOrganisationExists(
          dto.employerOrganisationId,
          PortalType.EMPLOYER,
        );
      }
      enrolment.employerOrganisationId = dto.employerOrganisationId;
    }
    if (dto.providerOrganisationId !== undefined) {
      if (dto.providerOrganisationId) {
        await this.assertOrganisationExists(
          dto.providerOrganisationId,
          PortalType.PROVIDER,
        );
      }
      enrolment.providerOrganisationId = dto.providerOrganisationId;
    }

    return this.enrichEnrolmentForDisplay(
      await this.enrolmentRepo.save(enrolment),
    );
  }

  /** Sync tripartite user IDs from a signed commitment when enrolment fields are unset. */
  async syncParticipantsIfUnset(
    enrolmentId: string,
    participants: {
      apprenticeUserId: string;
      tutorUserId: string;
      employerManagerUserId: string;
    },
  ): Promise<Enrolment | null> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, isDeleted: false },
    });
    if (!enrolment) {
      return null;
    }

    let changed = false;
    if (!enrolment.apprenticeUserId) {
      enrolment.apprenticeUserId = participants.apprenticeUserId;
      changed = true;
    }
    if (!enrolment.tutorUserId) {
      enrolment.tutorUserId = participants.tutorUserId;
      changed = true;
    }
    if (!enrolment.employerManagerUserId) {
      enrolment.employerManagerUserId = participants.employerManagerUserId;
      changed = true;
    }

    if (!changed) {
      return enrolment;
    }
    return this.enrolmentRepo.save(enrolment);
  }

  async findByIdForOrganisation(
    organisationId: string,
    id: string,
  ): Promise<Enrolment | null> {
    return this.enrolmentRepo.findOne({
      where: { id, organisationId, isDeleted: false },
    });
  }

  async activate(user: AuthenticatedUser, id: string): Promise<Enrolment> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id, organisationId: user.organisationId! },
      relations: ['apprentice'],
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }
    if (enrolment.status === EnrolmentStatus.ACTIVE) {
      return enrolment;
    }
    if (enrolment.status !== EnrolmentStatus.DRAFT) {
      throw new BadRequestException('Only draft enrolments can be activated');
    }
    enrolment.status = EnrolmentStatus.ACTIVE;
    enrolment.activatedAt = new Date();
    const saved = await this.enrolmentRepo.save(enrolment);
    return this.provisioningService.onActivate(saved, user);
  }

  async acceptProvider(
    user: AuthenticatedUser,
    id: string,
  ): Promise<Enrolment> {
    const enrolment = await this.findForProviderAccept(user, id);
    if (enrolment.status !== EnrolmentStatus.ACTIVE) {
      throw new BadRequestException(
        'Only active enrolments can be accepted by the provider',
      );
    }
    if (
      !this.pipelineService.isAtLeast(
        enrolment.pipelineState,
        EnrolmentPipelineState.ACCOUNT_CREATED,
      )
    ) {
      throw new BadRequestException(
        'Apprentice account must be created before provider acceptance',
      );
    }
    const advanced = await this.pipelineService.advanceIfAhead(
      enrolment.id,
      EnrolmentPipelineState.PROVIDER_ACCEPTED,
    );
    if (!advanced) {
      throw new NotFoundException('Enrolment not found');
    }
    return advanced;
  }

  private async findForProviderAccept(
    user: AuthenticatedUser,
    id: string,
  ): Promise<Enrolment> {
    const orgId = user.organisationId!;
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id, isDeleted: false },
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }

    const isProviderOrg =
      enrolment.providerOrganisationId === orgId ||
      (enrolment.providerOrganisationId === null &&
        enrolment.organisationId === orgId);
    if (!isProviderOrg) {
      throw new ForbiddenException(
        'Only the linked provider organisation can accept this enrolment',
      );
    }

    return enrolment;
  }

  async complete(user: AuthenticatedUser, id: string): Promise<Enrolment> {
    const enrolment = await this.findOne(user, id);
    if (enrolment.status === EnrolmentStatus.COMPLETED) {
      return enrolment;
    }
    if (enrolment.status !== EnrolmentStatus.ACTIVE) {
      throw new BadRequestException('Only active enrolments can be completed');
    }
    enrolment.status = EnrolmentStatus.COMPLETED;
    enrolment.completedAt = new Date();
    const saved = await this.enrolmentRepo.save(enrolment);
    await this.messageThreadsService.archiveForEnrolment(saved.id);
    await this.completionPushService.queueFromEnrolmentCompleted({
      organisationId: user.organisationId!,
      enrolmentId: saved.id,
      apprenticeId: saved.apprenticeId,
      learnerRef: saved.id,
      completionDate: this.toIsoDate(saved.completedAt!),
      requestedByUserId: user.id,
    });
    return saved;
  }

  async recordEpaOutcome(
    user: AuthenticatedUser,
    enrolmentId: string,
    dto: RecordEpaOutcomeDto,
  ): Promise<EpaOutcomeResponseDto> {
    const enrolment = await this.findOne(user, enrolmentId);
    if (enrolment.status !== EnrolmentStatus.COMPLETED) {
      throw new BadRequestException(
        'EPA outcome can only be recorded for completed enrolments',
      );
    }

    const existing = await this.epaOutcomeRepo.findOne({
      where: {
        enrolmentId,
        organisationId: user.organisationId!,
        isDeleted: false,
      },
    });
    if (existing) {
      throw new ConflictException('EPA outcome already recorded for enrolment');
    }

    const record = await this.epaOutcomeRepo.save(
      this.epaOutcomeRepo.create({
        organisationId: user.organisationId!,
        enrolmentId,
        outcome: dto.outcome,
        assessedOn: dto.assessedOn,
        recordedByUserId: user.id,
      }),
    );

    await this.completionPushService.queueFromEpaOutcome({
      organisationId: user.organisationId!,
      enrolmentId,
      apprenticeId: enrolment.apprenticeId,
      epaOutcomeId: record.id,
      learnerRef: enrolmentId,
      completionDate: this.toIsoDate(enrolment.completedAt!),
      epaOutcome: dto.outcome,
      requestedByUserId: user.id,
    });

    return {
      id: record.id,
      enrolmentId: record.enrolmentId,
      outcome: record.outcome,
      assessedOn: record.assessedOn,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async cancel(user: AuthenticatedUser, id: string): Promise<Enrolment> {
    const enrolment = await this.findOne(user, id);
    if (enrolment.status === EnrolmentStatus.CANCELLED) {
      return enrolment;
    }
    if (
      enrolment.status !== EnrolmentStatus.DRAFT &&
      enrolment.status !== EnrolmentStatus.ACTIVE
    ) {
      throw new BadRequestException(
        'Only draft or active enrolments can be cancelled',
      );
    }
    enrolment.status = EnrolmentStatus.CANCELLED;
    enrolment.cancelledAt = new Date();
    const saved = await this.enrolmentRepo.save(enrolment);
    await this.withdrawalPushService.queueFromEnrolment({
      organisationId: user.organisationId!,
      enrolmentId: saved.id,
      apprenticeId: saved.apprenticeId,
      requestedByUserId: user.id,
    });
    return saved;
  }

  private async findOneEntity(
    user: AuthenticatedUser,
    id: string,
    portalType?: PortalType,
  ): Promise<Enrolment> {
    if (portalType) {
      return this.findOneScoped(user, id, portalType);
    }

    for (const scope of [
      PortalType.PROVIDER,
      PortalType.FLOW,
      PortalType.EMPLOYER,
      PortalType.APPRENTICE,
    ]) {
      const enrolment = await this.enrolmentRepo.findOne({
        where: { ...buildEnrolmentListWhere(user, scope), id },
      });
      if (enrolment) {
        return enrolment;
      }
    }

    throw new NotFoundException('Enrolment not found');
  }

  private async enrichEnrolmentForDisplay(
    enrolment: Enrolment,
  ): Promise<EnrolmentWithDisplayLabels> {
    const [enriched] = await this.enrichEnrolmentsForDisplay([enrolment]);
    return enriched;
  }

  private async enrichEnrolmentsForDisplay(
    enrolments: Enrolment[],
  ): Promise<EnrolmentWithDisplayLabels[]> {
    if (enrolments.length === 0) {
      return [];
    }

    const apprenticeIds = [...new Set(enrolments.map((e) => e.apprenticeId))];
    const standardIds = [...new Set(enrolments.map((e) => e.standardId))];
    const userIds = [
      ...new Set(
        enrolments.flatMap((e) =>
          [e.apprenticeUserId, e.tutorUserId, e.employerManagerUserId].filter(
            (id): id is string => !!id,
          ),
        ),
      ),
    ];
    const linkOrgIds = [
      ...new Set(
        enrolments.flatMap((e) =>
          [e.employerOrganisationId, e.providerOrganisationId].filter(
            (id): id is string => !!id,
          ),
        ),
      ),
    ];

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const [apprentices, standards, users, organisations] = await Promise.all([
        this.apprenticeRepo.find({
          where: { id: In(apprenticeIds), isDeleted: false },
          select: ['id', 'firstName', 'lastName'],
        }),
        this.standardRepo.find({
          where: { id: In(standardIds), isDeleted: false },
          select: ['id', 'title', 'code'],
        }),
        userIds.length
          ? this.userRepo.find({
              where: { id: In(userIds), isDeleted: false },
              select: ['id', 'firstName', 'lastName', 'email'],
            })
          : Promise.resolve([]),
        linkOrgIds.length
          ? this.organisationRepo.find({
              where: { id: In(linkOrgIds), isDeleted: false },
              select: ['id', 'name'],
            })
          : Promise.resolve([]),
      ]);

      const apprenticeNameById = new Map(
        apprentices.map((apprentice) => [
          apprentice.id,
          `${apprentice.firstName} ${apprentice.lastName}`.trim() || null,
        ]),
      );
      const standardNameById = new Map(
        standards.map((standard) => [
          standard.id,
          this.formatStandardDisplayName(standard),
        ]),
      );
      const usersById = new Map(users.map((user) => [user.id, user]));
      const orgNameById = new Map(
        organisations.map((organisation) => [
          organisation.id,
          organisation.name,
        ]),
      );

      return enrolments.map((enrolment) =>
        Object.assign(enrolment, {
          apprenticeDisplayName:
            apprenticeNameById.get(enrolment.apprenticeId) ?? null,
          standardDisplayName:
            standardNameById.get(enrolment.standardId) ?? null,
          employerOrganisationName: enrolment.employerOrganisationId
            ? (orgNameById.get(enrolment.employerOrganisationId) ?? null)
            : null,
          providerOrganisationName: enrolment.providerOrganisationId
            ? (orgNameById.get(enrolment.providerOrganisationId) ?? null)
            : null,
          apprenticeUserDisplayName: enrolment.apprenticeUserId
            ? this.formatUserDisplayName(
                usersById.get(enrolment.apprenticeUserId),
              )
            : null,
          tutorUserDisplayName: enrolment.tutorUserId
            ? this.formatUserDisplayName(usersById.get(enrolment.tutorUserId))
            : null,
          employerManagerUserDisplayName: enrolment.employerManagerUserId
            ? this.formatUserDisplayName(
                usersById.get(enrolment.employerManagerUserId),
              )
            : null,
        }),
      );
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async loadUsersByIds(
    ids: string[],
  ): Promise<
    Map<string, Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>>
  > {
    if (ids.length === 0) {
      return new Map();
    }

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const users = await this.userRepo.find({
        where: { id: In(ids), isDeleted: false },
        select: ['id', 'firstName', 'lastName', 'email'],
      });
      return new Map(users.map((user) => [user.id, user]));
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private formatUserDisplayName(
    user?: Pick<User, 'firstName' | 'lastName' | 'email'> | null,
  ): string | null {
    if (!user) {
      return null;
    }
    const name = `${user.firstName} ${user.lastName}`.trim();
    return name ? `${name} (${user.email})` : user.email;
  }

  private formatStandardDisplayName(
    standard: Pick<Standard, 'title' | 'code'>,
  ): string | null {
    const title = standard.title?.trim();
    const code = standard.code?.trim();
    if (title && code) {
      return `${title} (${code})`;
    }
    return title || code || null;
  }

  private toParticipantUserOption(
    user: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>,
  ): ParticipantUserOptionDto {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      displayName: this.formatUserDisplayName(user)!,
    };
  }

  private async loadOrgMemberOptions(
    organisationId: string,
  ): Promise<ParticipantUserOptionDto[]> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const memberships = await this.membershipRepo.find({
        where: {
          organisation: { id: organisationId },
          status: MembershipStatus.ACTIVE,
          isDeleted: false,
        },
        relations: ['user'],
        order: { joinedAt: 'ASC' },
      });

      const seen = new Set<string>();
      const options: ParticipantUserOptionDto[] = [];
      for (const membership of memberships) {
        const user = membership.user;
        if (!user || seen.has(user.id)) {
          continue;
        }
        seen.add(user.id);
        options.push(this.toParticipantUserOption(user));
      }
      return options;
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async loadApprenticeUserCandidates(
    enrolment: Enrolment,
  ): Promise<ParticipantUserOptionDto[]> {
    const options: ParticipantUserOptionDto[] = [];
    const seen = new Set<string>();

    const addUser = (
      user?: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'> | null,
    ) => {
      if (!user || seen.has(user.id)) {
        return;
      }
      seen.add(user.id);
      options.push(this.toParticipantUserOption(user));
    };

    const email = enrolment.apprentice?.email?.trim();
    if (email) {
      const previousBootstrap = getRlsBootstrap();
      setRlsBootstrap(true);
      try {
        const user = await this.userRepo.findOne({
          where: { email, isDeleted: false },
          select: ['id', 'firstName', 'lastName', 'email'],
        });
        addUser(user);
      } finally {
        setRlsBootstrap(previousBootstrap);
      }
    }

    if (enrolment.apprenticeUserId) {
      const usersById = await this.loadUsersByIds([enrolment.apprenticeUserId]);
      addUser(usersById.get(enrolment.apprenticeUserId));
    }

    return options;
  }

  private async assertInOrganisation(
    organisationId: string,
    apprenticeId: string,
    standardId: string,
  ): Promise<void> {
    const [apprentice, standard] = await Promise.all([
      this.apprenticeRepo.findOne({
        where: { id: apprenticeId, organisationId },
      }),
      this.standardRepo.findOne({ where: { id: standardId, organisationId } }),
    ]);

    if (!apprentice) {
      throw new NotFoundException('Apprentice not found');
    }
    if (!standard) {
      throw new NotFoundException('Standard not found');
    }
  }

  private async assertProviderPortal(organisationId: string): Promise<void> {
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId, isDeleted: false },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    if (organisation.portalType !== PortalType.PROVIDER) {
      throw new ForbiddenException(
        'This action requires an active provider portal organisation',
      );
    }
  }

  private async assertOrganisationExists(
    organisationId: string,
    expectedPortalType?: PortalType,
  ): Promise<void> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      const organisation = await this.organisationRepo.findOne({
        where: { id: organisationId, isDeleted: false },
      });
      if (!organisation) {
        throw new NotFoundException('Organisation not found');
      }
      if (
        expectedPortalType &&
        organisation.portalType !== expectedPortalType
      ) {
        throw new BadRequestException(
          `Organisation must be a ${expectedPortalType} portal organisation`,
        );
      }
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private toIsoDate(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
