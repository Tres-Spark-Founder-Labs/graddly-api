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
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { User } from '../users/entities/user.entity.js';

import {
  ErasureRequestDto,
  ErasureSubjectType,
} from './dto/erasure-request.dto.js';
import { ErasureResponseDto } from './dto/erasure-response.dto.js';

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
      row.changes = scrubAuditChanges(row.changes, subjectEmail);
      if (row.actorUserId === subjectId) {
        row.actorUserId = null;
      }
      await this.auditRepo.save(row);
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
