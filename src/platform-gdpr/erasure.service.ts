import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { ERASED, scrubAuditChanges } from '../audit/audit-scrub.util.js';
import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import { AuditAction } from '../audit/enums/audit-action.enum.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { EmployerVisit } from '../employer-visits/entities/employer-visit.entity.js';
import { BreakInLearning } from '../enrolments/entities/break-in-learning.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { FundingClaimResolution } from '../ilr/entities/funding-claim-resolution.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { User } from '../users/entities/user.entity.js';

import {
  ErasureRequestDto,
  ErasureSubjectType,
} from './dto/erasure-request.dto.js';
import { ErasureResponseDto } from './dto/erasure-response.dto.js';

import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';

const ERASED_EMAIL_DOMAIN = '@invalid.graddly';

@Injectable()
export class ErasureService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Apprentice)
    private readonly apprenticeRepo: Repository<Apprentice>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(BreakInLearning)
    private readonly breakRepo: Repository<BreakInLearning>,
    @InjectRepository(EmployerVisit)
    private readonly visitRepo: Repository<EmployerVisit>,
    @InjectRepository(FundingClaimResolution)
    private readonly fundingClaimRepo: Repository<FundingClaimResolution>,
    @InjectRepository(AuditLogEntry)
    private readonly auditRepo: Repository<AuditLogEntry>,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async erase(dto: ErasureRequestDto): Promise<ErasureResponseDto> {
    if (dto.subjectType === ErasureSubjectType.USER) {
      return this.eraseUser(dto.subjectId, dto.reason);
    }
    if (dto.subjectType === ErasureSubjectType.APPRENTICE) {
      return this.eraseApprentice(dto.subjectId, dto.reason);
    }
    throw new BadRequestException('Unsupported subject type');
  }

  async eraseUser(
    userId: string,
    reason?: string,
  ): Promise<ErasureResponseDto> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { alreadyErased, anonymisedFields, auditRowsScrubbed } =
      await this.anonymiseUserRecord(user);

    await this.recordErasureAudit(
      'user',
      userId,
      reason,
      anonymisedFields,
      auditRowsScrubbed,
    );

    return {
      subjectType: ErasureSubjectType.USER,
      subjectId: userId,
      anonymisedFields: alreadyErased
        ? ['firstName', 'lastName', 'email']
        : anonymisedFields,
      auditRowsScrubbed,
      alreadyErased,
    };
  }

  async eraseApprentice(
    apprenticeId: string,
    reason?: string,
  ): Promise<ErasureResponseDto> {
    const apprentice = await this.apprenticeRepo.findOne({
      where: { id: apprenticeId },
    });
    if (!apprentice) {
      throw new NotFoundException('Apprentice not found');
    }

    const alreadyErased = apprentice.email.endsWith(ERASED_EMAIL_DOMAIN);
    const originalEmail = apprentice.email;
    const anonymisedFields: string[] = [];

    if (!alreadyErased) {
      apprentice.firstName = ERASED;
      apprentice.lastName = ERASED;
      apprentice.email = `erased-${apprentice.id}${ERASED_EMAIL_DOMAIN}`;
      await this.apprenticeRepo.save(apprentice);
      anonymisedFields.push('firstName', 'lastName', 'email');
    }

    await this.otjRepo
      .createQueryBuilder()
      .update(OtjLogEntry)
      .set({ note: ERASED })
      .where('"apprenticeId" = :apprenticeId', { apprenticeId })
      .andWhere('"note" IS NOT NULL')
      .execute();

    await this.messageRepo
      .createQueryBuilder()
      .update(Message)
      .set({ body: ERASED })
      .where(
        `"senderUserId" IN (
          SELECT "apprenticeUserId" FROM enrolments WHERE "apprenticeId" = :apprenticeId AND "apprenticeUserId" IS NOT NULL
        )`,
        { apprenticeId },
      )
      .execute();

    /**
     * Security hardening pass, item 5 — free text added since this service was
     * written, holding personal data reachable by an Article 17 request.
     *
     * Named column by column rather than through a blanket `save()`. The
     * columns NOT listed here are the point: `startedOn`, `expectedReturnDate`,
     * `actualReturnDate`, `visitedOn`, `visitType` and every foreign key stay
     * exactly as they were, because they are the evidential skeleton an ESFA
     * reconciliation and an Ofsted inspection are entitled to. Erasure removes
     * the person from the record; it does not remove the record.
     */

    /**
     * `break_in_learning.reason` is the sharpest case in this service.
     *
     * It routinely holds health or caring information — "long-term sickness",
     * "maternity leave", "caring for a parent". That is special-category data
     * under UK GDPR Article 9, held about a person who has asked to be
     * forgotten, on a row we must keep for funding audit.
     *
     * The safer default is applied: the reason is scrubbed, the dates and the
     * fact of the break survive. Whether the ESFA's retention duty overrides
     * erasure for the coded reason itself is a legal question, not an
     * engineering one — raised as question 16 in DECISIONS-FOR-CLIENT.md.
     */
    await this.breakRepo
      .createQueryBuilder()
      .update(BreakInLearning)
      .set({ reason: ERASED })
      .where(
        `"enrolmentId" IN (SELECT id FROM enrolments WHERE "apprenticeId" = :apprenticeId)`,
        { apprenticeId },
      )
      .execute();

    /**
     * Employer visit notes name people and discuss them by name. Scrubbed only
     * for visits that actually discussed this learner — resolved through
     * `employer_visit_learners` rather than by date, so a visit about a
     * different apprentice keeps its notes.
     */
    await this.visitRepo
      .createQueryBuilder()
      .update(EmployerVisit)
      .set({
        attendees: ERASED,
        discussionPoints: ERASED,
        actionPoints: ERASED,
      })
      .where(
        `id IN (
          SELECT l."visitId" FROM employer_visit_learners l
          JOIN enrolments e ON e.id = l."enrolmentId"
          WHERE e."apprenticeId" = :apprenticeId
        )`,
        { apprenticeId },
      )
      .execute();

    /**
     * The funding-claim note explains why money was written off, which is
     * evidential — but it is free text a human wrote about a named learner, so
     * it can contain personal data. Scrubbed on the same reasoning as the
     * others; the status, amounts and timestamps are untouched.
     */
    await this.fundingClaimRepo
      .createQueryBuilder()
      .update(FundingClaimResolution)
      .set({ note: ERASED })
      .where(
        `"enrolmentId" IN (SELECT id FROM enrolments WHERE "apprenticeId" = :apprenticeId)`,
        { apprenticeId },
      )
      .andWhere('"note" IS NOT NULL')
      .execute();

    const enrolments = await this.enrolmentRepo.find({
      where: { apprenticeId },
      select: ['apprenticeUserId'],
    });
    for (const enrolment of enrolments) {
      if (!enrolment.apprenticeUserId) continue;
      const linkedUser = await this.userRepo.findOne({
        where: { id: enrolment.apprenticeUserId },
      });
      if (linkedUser) {
        await this.anonymiseUserRecord(linkedUser);
      }
    }

    const auditRowsScrubbed = await this.scrubAuditForSubject(
      apprenticeId,
      originalEmail,
    );

    await this.recordErasureAudit(
      'apprentice',
      apprenticeId,
      reason,
      anonymisedFields,
      auditRowsScrubbed,
    );

    return {
      subjectType: ErasureSubjectType.APPRENTICE,
      subjectId: apprenticeId,
      anonymisedFields: alreadyErased
        ? ['firstName', 'lastName', 'email']
        : anonymisedFields,
      auditRowsScrubbed,
      alreadyErased,
    };
  }

  private async anonymiseUserRecord(user: User): Promise<{
    alreadyErased: boolean;
    anonymisedFields: string[];
    auditRowsScrubbed: number;
  }> {
    const alreadyErased = user.email.endsWith(ERASED_EMAIL_DOMAIN);
    const originalEmail = user.email;
    const anonymisedFields: string[] = [];

    if (!alreadyErased) {
      user.firstName = ERASED;
      user.lastName = ERASED;
      user.email = `erased-${user.id}${ERASED_EMAIL_DOMAIN}`;
      user.phone = null;
      user.dateOfBirth = null;
      user.avatarUrl = null;
      user.bio = null;
      user.isActive = false;
      await this.userRepo.save(user);
      anonymisedFields.push(
        'firstName',
        'lastName',
        'email',
        'phone',
        'dateOfBirth',
        'avatarUrl',
        'bio',
        'isActive',
      );
    }

    await this.refreshTokenService.revokeAllForUser(user.id);

    const auditRowsScrubbed = await this.scrubAuditForSubject(
      user.id,
      originalEmail,
    );

    return { alreadyErased, anonymisedFields, auditRowsScrubbed };
  }

  private async scrubAuditForSubject(
    subjectId: string,
    subjectEmail: string,
  ): Promise<number> {
    const rows = await this.auditRepo
      .createQueryBuilder('audit')
      .where('audit.actorUserId = :subjectId', { subjectId })
      .orWhere('audit.entityId = :subjectId', { subjectId })
      .getMany();

    let scrubbed = 0;
    for (const row of rows) {
      const isSubjectTheActor = row.actorUserId === subjectId;

      /**
       * F1.3.3 AC4 — written as an explicit column list rather than
       * `repo.save(row)`.
       *
       * The immutability trigger added in migration 1781100000027 rejects any
       * UPDATE that touches `entityType`, `entityId`, `action`,
       * `organisationId`, `createdAt`, `actorRole` or `description`.
       * `save()` would have worked only for as long as TypeORM kept emitting
       * a diffed, partial UPDATE — an implementation detail, not a promise.
       * The day it emitted every column, every erasure request would start
       * failing on a `restrict_violation` from the database.
       *
       * These three columns are the entire pseudonymisable set:
       *
       *  - `changes` may hold the subject's email inside the diff payload.
       *  - `actorUserId` identifies them directly.
       *  - `actorName` was added by AC2 so the trail reports who acted *at the
       *    time*; denormalising it is what makes the trail evidence, and it is
       *    also what makes it personal data this routine has to clear.
       *
       * `actorRole` is deliberately kept, and the trigger enforces that: it
       * describes a position, not a person, so the trail can still show that
       * "an employer manager" signed without identifying who.
       */
      await this.auditRepo
        .createQueryBuilder()
        .update(AuditLogEntry)
        .set({
          // `set` takes QueryDeepPartialEntity, which does not accept the
          // AuditChanges index signature directly.
          changes: scrubAuditChanges(
            row.changes,
            subjectEmail,
          ) as QueryDeepPartialEntity<AuditLogEntry>['changes'],
          ...(isSubjectTheActor ? { actorUserId: null, actorName: null } : {}),
        })
        .where('id = :id', { id: row.id })
        .execute();
      scrubbed += 1;
    }
    return scrubbed;
  }

  private async recordErasureAudit(
    entityType: string,
    entityId: string,
    reason: string | undefined,
    anonymisedFields: string[],
    auditRowsScrubbed: number,
  ): Promise<void> {
    const entry = this.auditRepo.create({
      actorUserId: null,
      organisationId: null,
      entityType,
      entityId,
      action: AuditAction.ERASE,
      changes: {
        reason: { to: reason ?? null },
        anonymisedFields: { to: anonymisedFields },
        auditRowsScrubbed: { to: auditRowsScrubbed },
      },
    });
    await this.auditRepo.save(entry);
  }
}
