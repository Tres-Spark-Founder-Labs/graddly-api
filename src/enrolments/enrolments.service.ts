import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { CompletionPushService } from '../completion-push/completion-push.service.js';
import { MessageThreadsService } from '../messaging/message-threads.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { WithdrawalPushService } from '../withdrawal-push/withdrawal-push.service.js';

import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { EpaOutcomeResponseDto } from './dto/epa-outcome-response.dto.js';
import { RecordEpaOutcomeDto } from './dto/record-epa-outcome.dto.js';
import { UpdateEnrolmentOrganisationLinksDto } from './dto/update-enrolment-organisation-links.dto.js';
import { UpdateEnrolmentParticipantsDto } from './dto/update-enrolment-participants.dto.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EpaOutcomeRecord } from './entities/epa-outcome.entity.js';
import { EnrolmentStatus } from './enums/enrolment-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

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
    @InjectRepository(EpaOutcomeRecord)
    private readonly epaOutcomeRepo: Repository<EpaOutcomeRecord>,
    private readonly withdrawalPushService: WithdrawalPushService,
    private readonly completionPushService: CompletionPushService,
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
  ): Promise<PaginatedResult<Enrolment>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await this.enrolmentRepo.findAndCount({
      where: { organisationId: user.organisationId! },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return new PaginatedResult(
      items,
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<Enrolment> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id, organisationId: user.organisationId! },
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }
    return enrolment;
  }

  async updateParticipants(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateEnrolmentParticipantsDto,
  ): Promise<Enrolment> {
    const enrolment = await this.findOne(user, id);
    if (dto.apprenticeUserId !== undefined) {
      enrolment.apprenticeUserId = dto.apprenticeUserId;
    }
    if (dto.tutorUserId !== undefined) {
      enrolment.tutorUserId = dto.tutorUserId;
    }
    if (dto.employerManagerUserId !== undefined) {
      enrolment.employerManagerUserId = dto.employerManagerUserId;
    }
    return this.enrolmentRepo.save(enrolment);
  }

  async updateOrganisationLinks(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateEnrolmentOrganisationLinksDto,
  ): Promise<Enrolment> {
    const enrolment = await this.findOne(user, id);

    if (dto.employerOrganisationId !== undefined) {
      if (dto.employerOrganisationId) {
        await this.assertOrganisationExists(dto.employerOrganisationId);
      }
      enrolment.employerOrganisationId = dto.employerOrganisationId;
    }
    if (dto.providerOrganisationId !== undefined) {
      if (dto.providerOrganisationId) {
        await this.assertOrganisationExists(dto.providerOrganisationId);
      }
      enrolment.providerOrganisationId = dto.providerOrganisationId;
    }

    return this.enrolmentRepo.save(enrolment);
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
    const enrolment = await this.findOne(user, id);
    if (enrolment.status === EnrolmentStatus.ACTIVE) {
      return enrolment;
    }
    if (enrolment.status !== EnrolmentStatus.DRAFT) {
      throw new BadRequestException('Only draft enrolments can be activated');
    }
    enrolment.status = EnrolmentStatus.ACTIVE;
    enrolment.activatedAt = new Date();
    return this.enrolmentRepo.save(enrolment);
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

  private async assertOrganisationExists(
    organisationId: string,
  ): Promise<void> {
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId, isDeleted: false },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
  }

  private toIsoDate(value: Date): string {
    return value.toISOString().slice(0, 10);
  }
}
