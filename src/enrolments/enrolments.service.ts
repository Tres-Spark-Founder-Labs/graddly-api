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
import { MessageThreadsService } from '../messaging/message-threads.service.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { WithdrawalPushService } from '../withdrawal-push/withdrawal-push.service.js';

import { CreateEnrolmentDto } from './dto/create-enrolment.dto.js';
import { UpdateEnrolmentParticipantsDto } from './dto/update-enrolment-participants.dto.js';
import { Enrolment } from './entities/enrolment.entity.js';
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
    private readonly withdrawalPushService: WithdrawalPushService,
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
    return saved;
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
}
