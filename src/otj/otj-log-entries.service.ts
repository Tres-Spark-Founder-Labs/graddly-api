import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { LearnerScopeService } from '../common/learner-scope/learner-scope.service.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { StorageObjectCategory } from '../storage/enums/storage-object-category.enum.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';
import { User } from '../users/entities/user.entity.js';

import { BulkOtjActionResponseDto } from './dto/bulk-otj-action-response.dto.js';
import { CreateOtjLogEntryDto } from './dto/create-otj-log-entry.dto.js';
import { FlagOtjLogEntryDto } from './dto/flag-otj-log-entry.dto.js';
import { ListOtjLogEntriesQueryDto } from './dto/list-otj-log-entries-query.dto.js';
import { OtjLogEntryResponseDto } from './dto/otj-log-entry-response.dto.js';
import { UpdateOtjLogEntryDto } from './dto/update-otj-log-entry.dto.js';
import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjLogStatus } from './enums/otj-log-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class OtjLogEntriesService {
  constructor(
    @InjectRepository(OtjLogEntry)
    private readonly repo: Repository<OtjLogEntry>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly emailDispatchService: EmailDispatchService,
    private readonly config: ConfigService,
    private readonly eifScoreCache: EifScoreCacheService,
    private readonly keyBuilder: StorageKeyBuilder,
    private readonly learnerScope: LearnerScopeService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateOtjLogEntryDto,
  ): Promise<OtjLogEntryResponseDto> {
    const organisationId = user.organisationId!;
    await this.assertEnrolmentMatch(user, dto.enrolmentId, dto.apprenticeId);
    this.assertEvidence(organisationId, dto.apprenticeId, dto.evidence);

    const entity = this.repo.create({
      organisationId,
      enrolmentId: dto.enrolmentId,
      apprenticeId: dto.apprenticeId,
      loggedDate: dto.loggedDate,
      minutes: dto.minutes,
      activityName: dto.activityName,
      category: dto.category,
      note: dto.note ?? null,
      evidence: dto.evidence ?? null,
      status: OtjLogStatus.DRAFT,
    });
    return this.toResponse(await this.repo.save(entity));
  }

  async findAll(
    user: AuthenticatedUser,
    query: ListOtjLogEntriesQueryDto,
  ): Promise<PaginatedResult<OtjLogEntryResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const employerEnrolmentIds = await this.loadEmployerEnrolmentIds(
      user.organisationId!,
    );

    if (employerEnrolmentIds !== null && employerEnrolmentIds.length === 0) {
      return new PaginatedResult(
        [],
        buildPaginationMeta({ total: 0, page, perPage }),
      );
    }

    const qb = this.repo
      .createQueryBuilder('otj')
      // F1.2.3 AC1 — the approval queue lists apprentice names. Joined once
      // here rather than looked up per row by the client.
      .leftJoinAndSelect('otj.apprentice', 'apprentice')
      .where('otj.isDeleted = false');

    if (employerEnrolmentIds !== null) {
      qb.andWhere('otj.enrolmentId IN (:...employerEnrolmentIds)', {
        employerEnrolmentIds,
      });
    } else {
      qb.andWhere('otj.organisationId = :organisationId', {
        organisationId: user.organisationId!,
      });
    }

    /**
     * Survey finding 4. The organisation filter above is the ONLY owner
     * constraint this query used to have, and `query.apprenticeId` below is
     * optional — so an apprentice, who is a plain member of the provider's
     * organisation, could omit it and receive every learner's sessions. Not
     * theoretical: proven in `otj-learner-scope.e2e-spec.ts`.
     *
     * `null` means "the caller is not a learner", which is staff and must not
     * be narrowed. The distinction matters: an empty array here would silently
     * blank the provider's approval queue.
     */
    const learnerEnrolmentIds =
      await this.learnerScope.ownEnrolmentIds(user);
    if (learnerEnrolmentIds !== null) {
      qb.andWhere('otj.enrolmentId IN (:...learnerEnrolmentIds)', {
        learnerEnrolmentIds,
      });
    }

    if (query.status)
      qb.andWhere('otj.status = :status', { status: query.status });
    if (query.apprenticeId)
      qb.andWhere('otj.apprenticeId = :apprenticeId', {
        apprenticeId: query.apprenticeId,
      });
    if (query.enrolmentId)
      qb.andWhere('otj.enrolmentId = :enrolmentId', {
        enrolmentId: query.enrolmentId,
      });
    if (query.category)
      qb.andWhere('otj.category = :category', { category: query.category });
    if (query.from)
      qb.andWhere('otj.loggedDate >= :from', { from: query.from });
    if (query.to) qb.andWhere('otj.loggedDate <= :to', { to: query.to });

    qb.orderBy('otj.createdAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage);
    const [rows, total] = await qb.getManyAndCount();
    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<OtjLogEntryResponseDto> {
    const row = await this.findAccessibleEntry(user, id);
    if (!row) throw new NotFoundException('OTJ log entry not found');
    return this.toResponse(row);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateOtjLogEntryDto,
  ): Promise<OtjLogEntryResponseDto> {
    const row = await this.findAccessibleEntry(user, id);
    if (!row) throw new NotFoundException('OTJ log entry not found');

    const organisationId = row.organisationId;
    const enrolmentId = dto.enrolmentId ?? row.enrolmentId;
    const apprenticeId = dto.apprenticeId ?? row.apprenticeId;
    if (dto.enrolmentId !== undefined || dto.apprenticeId !== undefined) {
      await this.assertEnrolmentMatch(user, enrolmentId, apprenticeId);
    }
    if (dto.evidence !== undefined) {
      this.assertEvidence(organisationId, apprenticeId, dto.evidence);
    }

    if (dto.status !== undefined) {
      this.applyStatusTransition(row, dto.status);
    }

    if (dto.enrolmentId !== undefined) row.enrolmentId = dto.enrolmentId;
    if (dto.apprenticeId !== undefined) row.apprenticeId = dto.apprenticeId;
    if (dto.loggedDate !== undefined) row.loggedDate = dto.loggedDate;
    if (dto.minutes !== undefined) row.minutes = dto.minutes;
    if (dto.activityName !== undefined) row.activityName = dto.activityName;
    if (dto.category !== undefined) row.category = dto.category;
    if (dto.note !== undefined) row.note = dto.note;
    if (dto.evidence !== undefined) row.evidence = dto.evidence;

    return this.toResponse(await this.repo.save(row));
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.findAccessibleEntry(user, id);
    if (!row) throw new NotFoundException('OTJ log entry not found');
    await this.repo.softRemove(row);
  }

  async bulkApprove(
    user: AuthenticatedUser,
    ids: string[],
  ): Promise<BulkOtjActionResponseDto> {
    return this.bulkTransition(user, ids, OtjLogStatus.APPROVED);
  }

  /**
   * `reason` is required (F1.2.3 AC3) and validated at the DTO. Typed as
   * non-optional here so the requirement survives any future caller that
   * bypasses the controller.
   */
  async bulkReject(
    user: AuthenticatedUser,
    ids: string[],
    reason: string,
  ): Promise<BulkOtjActionResponseDto> {
    return this.bulkTransition(user, ids, OtjLogStatus.REJECTED, reason);
  }

  private async bulkTransition(
    user: AuthenticatedUser,
    ids: string[],
    target: OtjLogStatus.APPROVED | OtjLogStatus.REJECTED,
    reason?: string,
  ): Promise<BulkOtjActionResponseDto> {
    const results: BulkOtjActionResponseDto['results'] = [];
    for (const id of ids) {
      let notificationQueued = false;
      try {
        const row = await this.findAccessibleEntry(user, id);
        if (!row) {
          results.push({
            id,
            ok: false,
            reasonCode: 'not_found',
            message: 'OTJ log entry not found',
            notificationQueued,
          });
          continue;
        }
        if (row.status !== OtjLogStatus.SUBMITTED && row.status !== target) {
          throw new BadRequestException('invalid_transition');
        }
        if (target === OtjLogStatus.APPROVED) {
          row.status = OtjLogStatus.APPROVED;
          row.approvedAt = new Date();
          row.approvedByUserId = user.id;
          row.rejectedAt = null;
          row.rejectedByUserId = null;
          row.rejectionReason = null;
        } else {
          row.status = OtjLogStatus.REJECTED;
          row.rejectedAt = new Date();
          row.rejectedByUserId = user.id;
          row.rejectionReason = reason ?? null;
        }
        await this.repo.save(row);
        notificationQueued = await this.notifyApprenticeOfDecision(row, target);
        results.push({
          id,
          ok: true,
          reasonCode: null,
          message: null,
          notificationQueued,
        });
      } catch (error) {
        const reasonCode =
          error instanceof BadRequestException
            ? 'invalid_transition'
            : 'internal_error';
        results.push({
          id,
          ok: false,
          reasonCode,
          message: error instanceof Error ? error.message : String(error),
          notificationQueued,
        });
      }
    }

    if (
      results.some((r) => r.ok) &&
      (target === OtjLogStatus.APPROVED || target === OtjLogStatus.REJECTED)
    ) {
      const providerOrgIds = new Set<string>();
      for (const id of ids) {
        const row = await this.repo.findOne({
          where: { id, isDeleted: false },
          select: ['organisationId'],
        });
        if (row?.organisationId) providerOrgIds.add(row.organisationId);
      }
      await Promise.all(
        [...providerOrgIds].map((orgId) =>
          this.eifScoreCache.invalidate(orgId),
        ),
      );
    }

    return {
      processed: results.length,
      succeeded: results.filter((x) => x.ok).length,
      failed: results.filter((x) => !x.ok).length,
      results,
    };
  }

  /**
   * Employer portal: OTJ rows live under the provider org but belong to
   * enrolments linked via employerOrganisationId (same rule as employer dashboard).
   * Returns null for non-employer orgs.
   */
  private async loadEmployerEnrolmentIds(
    organisationId: string,
  ): Promise<string[] | null> {
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId, isDeleted: false },
      select: ['portalType'],
    });
    if (organisation?.portalType !== PortalType.EMPLOYER) {
      return null;
    }

    const enrolments = await this.enrolmentRepo.find({
      where: {
        employerOrganisationId: organisationId,
        status: EnrolmentStatus.ACTIVE,
        isDeleted: false,
      },
      select: ['id'],
    });
    return enrolments.map((e) => e.id);
  }

  /**
   * Tells the apprentice what happened to the entry they submitted.
   *
   * This previously notified `user.id` — the manager who had just pressed the
   * button — so the only person told about the decision was the person who
   * made it, while the apprentice who submitted the work was never informed.
   * A rejection carries a mandatory explanation (AC3); sending that
   * explanation to the manager instead of the apprentice makes the
   * requirement pointless.
   *
   * The email also used `EmailTemplate.EMAIL_VERIFICATION`, so approving a log
   * entry sent the manager a "verify your email address" message with a
   * `verifyUrl` that fell back to `'#'`.
   *
   * Returns whether the notification was queued; failures here must not fail
   * the approval itself, which is already committed.
   */
  private async notifyApprenticeOfDecision(
    row: OtjLogEntry,
    target: OtjLogStatus.APPROVED | OtjLogStatus.REJECTED,
  ): Promise<boolean> {
    const apprenticeUserId = row.enrolment?.apprenticeUserId;
    if (!apprenticeUserId) {
      // Enrolments can exist before the apprentice has a portal login. There
      // is no one to notify, which is not an error.
      return false;
    }

    const approved = target === OtjLogStatus.APPROVED;

    try {
      await this.notificationsService.createForUser({
        userId: apprenticeUserId,
        organisationId: row.organisationId,
        type: NotificationType.OTJ,
        title: approved
          ? 'Off-the-job log approved'
          : 'Off-the-job log sent back',
        body: approved
          ? `"${row.activityName}" was approved and now counts towards your off-the-job total.`
          : `"${row.activityName}" was sent back: ${row.rejectionReason ?? ''}`.trim(),
        metadata: {
          otjLogEntryId: row.id,
          status: target,
          rejectionReason: approved ? null : row.rejectionReason,
        },
      });

      const apprenticeUser = await this.userRepo.findOne({
        where: { id: apprenticeUserId, isDeleted: false },
      });

      if (apprenticeUser?.email) {
        await this.emailDispatchService.enqueue(
          new SerializedEmailPayload(
            EmailTemplate.OTJ_DECISION,
            apprenticeUser.email,
            {
              firstName: apprenticeUser.firstName ?? 'there',
              approved,
              activityName: row.activityName,
              loggedDate:
                typeof row.loggedDate === 'string'
                  ? row.loggedDate.slice(0, 10)
                  : String(row.loggedDate),
              hours: (row.minutes / 60).toFixed(1),
              reason: row.rejectionReason ?? '',
              appName: this.config.get<string>('app.email.appName', 'Graddly'),
            },
          ),
        );
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * The single resolution point behind `findOne`, `update`, `remove` and the
   * bulk transitions — which is why the learner check belongs here rather than
   * in five callers. Returning `null` (never throwing) keeps not-found and
   * not-yours indistinguishable at every one of them, as D3 requires.
   */
  private async findAccessibleEntry(
    user: AuthenticatedUser,
    id: string,
  ): Promise<OtjLogEntry | null> {
    const learnerEnrolmentIds =
      await this.learnerScope.ownEnrolmentIds(user);
    if (learnerEnrolmentIds !== null) {
      return this.repo.findOne({
        where: {
          id,
          organisationId: user.organisationId!,
          enrolmentId: In(learnerEnrolmentIds),
          isDeleted: false,
        },
        relations: ['enrolment'],
      });
    }

    const employerEnrolmentIds = await this.loadEmployerEnrolmentIds(
      user.organisationId!,
    );

    if (employerEnrolmentIds !== null) {
      if (employerEnrolmentIds.length === 0) {
        return null;
      }
      return this.repo.findOne({
        where: {
          id,
          enrolmentId: In(employerEnrolmentIds),
          isDeleted: false,
        },
        // The enrolment carries `apprenticeUserId`, which approve/reject needs
        // in order to notify the person who submitted the entry.
        relations: ['enrolment'],
      });
    }

    return this.repo.findOne({
      where: {
        id,
        organisationId: user.organisationId!,
        isDeleted: false,
      },
      relations: ['enrolment'],
    });
  }

  private applyStatusTransition(row: OtjLogEntry, target: OtjLogStatus): void {
    if (row.status === target) {
      return;
    }
    if (
      target === OtjLogStatus.SUBMITTED &&
      row.status === OtjLogStatus.DRAFT
    ) {
      row.status = OtjLogStatus.SUBMITTED;
      // AC1 — the queue shows how long an entry has been waiting on a manager.
      row.submittedAt = new Date();
      return;
    }
    throw new BadRequestException(
      `Cannot transition OTJ log entry from ${row.status} to ${target}`,
    );
  }

  /**
   * The shared validator behind both `create` and `update`, which is why the
   * learner check belongs here.
   *
   * It previously proved only that the enrolment lived in the organisation and
   * that the apprentice matched it — both true of *every other learner's*
   * enrolment. So a learner could log hours against a peer's programme, or
   * move one of their own entries onto it. Neither is a read, so the read-side
   * narrowing does not cover them.
   */
  private async assertEnrolmentMatch(
    user: AuthenticatedUser,
    enrolmentId: string,
    apprenticeId: string,
  ): Promise<void> {
    const organisationId = user.organisationId!;
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
    });
    if (!enrolment) {
      throw new BadRequestException('Enrolment not found in organisation');
    }
    if (enrolment.apprenticeId !== apprenticeId) {
      throw new BadRequestException('Apprentice does not match enrolment');
    }

    const ownEnrolmentIds = await this.learnerScope.ownEnrolmentIds(user);
    if (ownEnrolmentIds !== null && !ownEnrolmentIds.includes(enrolmentId)) {
      // Same message as the miss above: a learner probing enrolment ids learns
      // nothing about which of them exist.
      throw new BadRequestException('Enrolment not found in organisation');
    }
  }

  private assertEvidence(
    organisationId: string,
    apprenticeId: string,
    evidence: Record<string, unknown> | null | undefined,
  ): void {
    if (!evidence) return;

    const files = evidence.files;
    if (files === undefined) return;
    if (!Array.isArray(files)) {
      throw new BadRequestException(
        'evidence.files must be an array of storage keys',
      );
    }

    const expectedPrefix = `orgs/${organisationId}/learners/${apprenticeId}/${StorageObjectCategory.EVIDENCE}/`;
    for (const key of files) {
      if (typeof key !== 'string') {
        throw new BadRequestException(
          'evidence.files must contain storage key strings',
        );
      }
      if (!this.keyBuilder.belongsToOrganisation(key, organisationId)) {
        throw new BadRequestException(`Invalid storage key: ${key}`);
      }
      if (!key.startsWith(expectedPrefix)) {
        throw new BadRequestException(
          'Storage key must be an evidence object for this apprentice',
        );
      }
    }
  }

  /** Full name when the apprentice relation was loaded, otherwise null. */
  private apprenticeNameOf(entity: OtjLogEntry): string | null {
    const apprentice = entity.apprentice;
    if (!apprentice) return null;
    const name = `${apprentice.firstName ?? ''} ${apprentice.lastName ?? ''}`;
    return name.trim() || null;
  }

  private toResponse(entity: OtjLogEntry): OtjLogEntryResponseDto {
    return {
      id: entity.id,
      organisationId: entity.organisationId,
      enrolmentId: entity.enrolmentId,
      apprenticeId: entity.apprenticeId,
      apprenticeName: this.apprenticeNameOf(entity),
      loggedDate: entity.loggedDate,
      submittedAt: entity.submittedAt
        ? new Date(entity.submittedAt).toISOString()
        : null,
      minutes: entity.minutes,
      activityName: entity.activityName,
      category: entity.category,
      note: entity.note,
      evidence: entity.evidence,
      status: entity.status,
      paceFlag: entity.paceFlag,
      rejectionReason: entity.rejectionReason,
      flaggedAt: entity.flaggedAt ? entity.flaggedAt.toISOString() : null,
      flagNote: entity.flagNote,
    };
  }

  /**
   * F2.2.4 AC3 — a tutor flags an entry for discussion.
   *
   * Deliberately independent of the approval status. The employer decides
   * whether hours count; the tutor is saying this one needs a conversation.
   * An approved entry can still be flagged — the hours stand and the question
   * remains — and flagging never changes the status, because silently
   * un-approving hours behind an employer's back would be worse than the
   * problem being raised.
   */
  async flag(
    user: AuthenticatedUser,
    id: string,
    dto: FlagOtjLogEntryDto,
  ): Promise<OtjLogEntryResponseDto> {
    const organisationId = user.organisationId!;
    const entry = await this.repo.findOne({
      where: { id, organisationId, isDeleted: false },
      relations: ['apprentice'],
    });
    if (!entry) throw new NotFoundException('OTJ log entry not found');

    entry.flaggedAt = new Date();
    entry.flaggedByUserId = user.id;
    entry.flagNote = dto.note.trim();

    return this.toResponse(await this.repo.save(entry));
  }

  /** Clears a flag once the conversation has happened. */
  async unflag(
    user: AuthenticatedUser,
    id: string,
  ): Promise<OtjLogEntryResponseDto> {
    const organisationId = user.organisationId!;
    const entry = await this.repo.findOne({
      where: { id, organisationId, isDeleted: false },
      relations: ['apprentice'],
    });
    if (!entry) throw new NotFoundException('OTJ log entry not found');

    entry.flaggedAt = null;
    entry.flaggedByUserId = null;
    entry.flagNote = null;

    return this.toResponse(await this.repo.save(entry));
  }
}
