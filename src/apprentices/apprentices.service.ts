import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { WithdrawalPushService } from '../withdrawal-push/withdrawal-push.service.js';

import { CreateApprenticeDto } from './dto/create-apprentice.dto.js';
import { UpdateApprenticeDto } from './dto/update-apprentice.dto.js';
import { Apprentice } from './entities/apprentice.entity.js';
import { ApprenticeStatus } from './enums/apprentice-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class ApprenticesService {
  constructor(
    @InjectRepository(Apprentice)
    private readonly apprenticeRepo: Repository<Apprentice>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    private readonly withdrawalPushService: WithdrawalPushService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateApprenticeDto,
  ): Promise<Apprentice> {
    const organisationId = user.organisationId!;
    const email = dto.email.trim().toLowerCase();
    const existing = await this.apprenticeRepo.findOne({
      where: { organisationId, email },
    });
    if (existing && !existing.isDeleted) {
      throw new ConflictException('Apprentice with email already exists');
    }

    const apprentice = this.apprenticeRepo.create({
      organisationId,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email,
      // Trimmed to null rather than stored as "": an empty payroll reference
      // is an absent one, and "" would defeat the partial index.
      employeeId: dto.employeeId?.trim() || null,
      jobTitle: dto.jobTitle?.trim() || null,
      status: dto.status,
    });

    return this.apprenticeRepo.save(apprentice);
  }

  /**
   * The caller's roster, derived differently for each portal.
   *
   * ── WHY AN EMPLOYER SAW NOTHING ─────────────────────────────────────────────
   *
   * This filtered on `organisationId` alone. An Apprentice row is stamped with
   * the organisation that created it, which is the provider, so every
   * employer's roster was empty — for F1.2.1, a Phase 1 Must Have, on every
   * account, always.
   *
   * ── THE MODEL ───────────────────────────────────────────────────────────────
   *
   * The apprentice stays provider-owned and the employer's view is derived
   * from enrolments. PRD §9.2 gives an apprentice exactly one employer and one
   * provider at a time, and the Enrolment already carries both — adding a
   * second owner column to Apprentice would duplicate a relationship that is
   * modelled correctly one table over, and leave two places to disagree about
   * who the employer is.
   *
   * The database already committed to this: migration 1781100000047 added
   * `apprentices_select_linked_org`, admitting a row when an enrolment links it
   * to the current org as either party, precisely because "the other party to
   * the enrolment is then locked out of the learner's name, which is on every
   * screen either portal shows". The row policy has permitted this read all
   * along; this query is what never asked for it.
   *
   * ── SCOPED BY PORTAL, NOT ONE WIDE OR ───────────────────────────────────────
   *
   * An employer is admitted only where they are the *employer* on the
   * enrolment, never the provider. That is narrower than the RLS policy, which
   * accepts either side — the two are meant to agree on what is forbidden, not
   * to be the same expression, and the tighter of the two belongs here where
   * the intent is legible.
   */
  async findAll(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Apprentice>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const organisationId = user.organisationId!;

    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId, isDeleted: false },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }

    const qb = this.apprenticeRepo
      .createQueryBuilder('apprentice')
      .where('apprentice.isDeleted = false');

    if (organisation.portalType === PortalType.EMPLOYER) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM enrolments e
            WHERE e."apprenticeId" = apprentice.id
              AND e."isDeleted" = false
              AND e."employerOrganisationId" = :organisationId
         )`,
        { organisationId },
      );
    } else {
      // Providers and every other portal keep the ownership rule exactly as it
      // was. Only the employer path is new.
      qb.andWhere('apprentice.organisationId = :organisationId', {
        organisationId,
      });
    }

    const [items, total] = await qb
      .orderBy('apprentice.createdAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    return new PaginatedResult(
      items,
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<Apprentice> {
    const apprentice = await this.apprenticeRepo.findOne({
      where: { id, organisationId: user.organisationId! },
    });
    if (!apprentice) {
      throw new NotFoundException('Apprentice not found');
    }
    return apprentice;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateApprenticeDto,
  ): Promise<Apprentice> {
    const apprentice = await this.findOne(user, id);
    const organisationId = user.organisationId!;

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== apprentice.email) {
        const duplicate = await this.apprenticeRepo.findOne({
          where: { organisationId, email },
        });
        if (
          duplicate &&
          duplicate.id !== apprentice.id &&
          !duplicate.isDeleted
        ) {
          throw new ConflictException('Apprentice with email already exists');
        }
      }
      apprentice.email = email;
    }

    if (dto.firstName !== undefined)
      apprentice.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) apprentice.lastName = dto.lastName.trim();
    if (dto.employeeId !== undefined)
      apprentice.employeeId = dto.employeeId?.trim() || null;
    if (dto.jobTitle !== undefined)
      apprentice.jobTitle = dto.jobTitle?.trim() || null;
    const wasWithdrawn = apprentice.status === ApprenticeStatus.WITHDRAWN;
    if (dto.status !== undefined) apprentice.status = dto.status;

    const updated = await this.apprenticeRepo.save(apprentice);
    if (!wasWithdrawn && updated.status === ApprenticeStatus.WITHDRAWN) {
      await this.withdrawalPushService.queueFromApprenticeWithdrawal({
        organisationId,
        apprenticeId: updated.id,
        requestedByUserId: user.id,
      });
    }

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const apprentice = await this.findOne(user, id);
    await this.apprenticeRepo.softRemove(apprentice);
  }
}
