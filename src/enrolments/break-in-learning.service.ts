import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { ApprenticeStatus } from '../apprentices/enums/apprentice-status.enum.js';
import { WithdrawalPushService } from '../withdrawal-push/withdrawal-push.service.js';

import { BreakInLearningResponseDto } from './dto/break-in-learning-response.dto.js';
import {
  EndBreakInLearningDto,
  RecordBreakInLearningDto,
} from './dto/record-break-in-learning.dto.js';
import { BreakInLearning } from './entities/break-in-learning.entity.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EnrolmentStatus } from './enums/enrolment-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/** `YYYY-MM-DD` in UTC, matching how every other `date` column is written. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * F2.2.4 AC6 — break in learning: record the reason, the expected return, and
 * tell DAS.
 *
 * Before this, pausing a learner was a status change and nothing else. The
 * profile promised `reason` and `expectedReturnDate` and returned a hardcoded
 * `null` for both, and the ESFA was never told — even though a planned break
 * moves the expected end date and the funding schedule with it.
 */
@Injectable()
export class BreakInLearningService {
  constructor(
    @InjectRepository(BreakInLearning)
    private readonly repo: Repository<BreakInLearning>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Apprentice)
    private readonly apprenticeRepo: Repository<Apprentice>,
    private readonly withdrawalPushService: WithdrawalPushService,
  ) {}

  async start(
    user: AuthenticatedUser,
    enrolmentId: string,
    dto: RecordBreakInLearningDto,
  ): Promise<BreakInLearningResponseDto> {
    const organisationId = user.organisationId!;
    const enrolment = await this.findEnrolment(organisationId, enrolmentId);

    /**
     * A break interrupts learning that is happening. Pausing a cancelled or
     * completed enrolment is not a break, it is a data-entry mistake, and
     * letting it through would put a nonsense pause on the ILR.
     */
    if (enrolment.status !== EnrolmentStatus.ACTIVE) {
      throw new BadRequestException(
        `Only an active enrolment can go on a break in learning (this one is ${enrolment.status})`,
      );
    }

    const existing = await this.findOpen(organisationId, enrolmentId);
    if (existing) {
      throw new BadRequestException(
        'This learner is already on a break in learning. Record their return first.',
      );
    }

    const startedOn = dto.startedOn ?? today();
    if (dto.expectedReturnDate && dto.expectedReturnDate < startedOn) {
      throw new BadRequestException(
        'Expected return date cannot be before the break starts',
      );
    }

    const row = this.repo.create({
      organisationId,
      enrolmentId,
      apprenticeId: enrolment.apprenticeId,
      reason: dto.reason.trim(),
      startedOn,
      expectedReturnDate: dto.expectedReturnDate ?? null,
      actualReturnDate: null,
      recordedByUserId: user.id,
    });
    const saved = await this.repo.save(row);

    await this.apprenticeRepo.update(enrolment.apprenticeId, {
      status: ApprenticeStatus.PAUSED,
    });

    /**
     * Queued after the break is saved, so a push failure cannot leave a
     * learner paused with no record of why. The push has its own retry;
     * losing the break record would be unrecoverable.
     */
    await this.withdrawalPushService.queueFromBreakInLearning({
      organisationId,
      enrolmentId,
      apprenticeId: enrolment.apprenticeId,
      reason: saved.reason,
      startedOn: saved.startedOn,
      expectedReturnDate: saved.expectedReturnDate,
      requestedByUserId: user.id,
    });
    saved.dasNotifiedAt = new Date();
    await this.repo.save(saved);

    return this.toResponse(saved);
  }

  async end(
    user: AuthenticatedUser,
    enrolmentId: string,
    dto: EndBreakInLearningDto,
  ): Promise<BreakInLearningResponseDto> {
    const organisationId = user.organisationId!;
    const enrolment = await this.findEnrolment(organisationId, enrolmentId);

    const open = await this.findOpen(organisationId, enrolmentId);
    if (!open) {
      throw new BadRequestException(
        'This learner is not currently on a break in learning',
      );
    }

    const actualReturnDate = dto.actualReturnDate ?? today();
    if (actualReturnDate < open.startedOn) {
      throw new BadRequestException(
        'Return date cannot be before the break started',
      );
    }

    open.actualReturnDate = actualReturnDate;
    open.endedByUserId = user.id;
    const saved = await this.repo.save(open);

    await this.apprenticeRepo.update(enrolment.apprenticeId, {
      status: ApprenticeStatus.ACTIVE,
    });

    await this.withdrawalPushService.queueFromBreakInLearningEnded({
      organisationId,
      enrolmentId,
      apprenticeId: enrolment.apprenticeId,
      actualReturnDate,
      requestedByUserId: user.id,
    });

    return this.toResponse(saved);
  }

  /** Newest first — the current break, then the history behind it. */
  async list(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<BreakInLearningResponseDto[]> {
    const organisationId = user.organisationId!;
    await this.findEnrolment(organisationId, enrolmentId);

    const rows = await this.repo.find({
      where: { enrolmentId, isDeleted: false },
      order: { startedOn: 'DESC' },
    });
    return rows.map((row) => this.toResponse(row));
  }

  /** The open break for a learner profile, or `null`. */
  async findOpen(
    organisationId: string,
    enrolmentId: string,
  ): Promise<BreakInLearning | null> {
    return this.repo.findOne({
      where: {
        organisationId,
        enrolmentId,
        // IsNull(), not undefined — TypeORM drops an undefined condition
        // entirely, which would return any break including closed ones and
        // make "is this learner on a break" answer yes forever.
        actualReturnDate: IsNull(),
        isDeleted: false,
      },
    });
  }

  private async findEnrolment(
    organisationId: string,
    enrolmentId: string,
  ): Promise<Enrolment> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
    });
    if (!enrolment) throw new NotFoundException('Enrolment not found');
    return enrolment;
  }

  private toResponse(row: BreakInLearning): BreakInLearningResponseDto {
    return {
      id: row.id,
      enrolmentId: row.enrolmentId,
      reason: row.reason,
      startedOn: row.startedOn,
      expectedReturnDate: row.expectedReturnDate,
      actualReturnDate: row.actualReturnDate,
      active: row.actualReturnDate === null,
      dasNotifiedAt: row.dasNotifiedAt ? row.dasNotifiedAt.toISOString() : null,
    };
  }
}
