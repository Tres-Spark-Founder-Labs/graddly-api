import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { EmployerVisitLearner } from './entities/employer-visit-learner.entity.js';
import { EmployerVisit } from './entities/employer-visit.entity.js';

import type { CreateEmployerVisitDto } from './dto/create-employer-visit.dto.js';
import type { ListEmployerVisitsQueryDto } from './dto/list-employer-visits-query.dto.js';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { IPaginationMeta } from '../common/pagination/pagination-meta.interface.js';

/**
 * F2.4.2 AC4 — "system suggests next visit date based on visit frequency
 * requirements".
 *
 * Twelve weeks, matching the review cycle. Employer engagement is expected to
 * keep pace with progress reviews, and giving the two different rhythms means
 * a tutor making two trips where one would do.
 */
export const EMPLOYER_VISIT_INTERVAL_WEEKS = 12;

/**
 * Render a `date` value as YYYY-MM-DD without letting a timezone touch it.
 *
 * The SQL casts to text so this should always receive a string. It stays
 * defensive because a driver returning a `Date` is the failure that produced
 * an off-by-one-day bug here once already — and it reads the *local* parts,
 * never `toISOString()`, because a date-only value arrives as local midnight
 * and UTC-converting it moves the day backwards east of Greenwich.
 */
function toDateOnly(value: string | Date): string {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

@Injectable()
export class EmployerVisitsService {
  constructor(
    @InjectRepository(EmployerVisit)
    private readonly visitRepo: Repository<EmployerVisit>,
    @InjectRepository(EmployerVisitLearner)
    private readonly linkRepo: Repository<EmployerVisitLearner>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    private readonly portalService: ReportingPortalService,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateEmployerVisitDto,
  ): Promise<EmployerVisit> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    /**
     * Every named learner must be on an enrolment this provider owns *with
     * this employer*.
     *
     * Checking only that the enrolment belongs to the provider would let a
     * visit to employer A cite a learner placed with employer B — which would
     * then surface on B's profile as evidence of a meeting that never
     * discussed them.
     */
    const enrolmentIds = [...new Set(dto.enrolmentIds ?? [])];
    if (enrolmentIds.length > 0) {
      const valid = await this.enrolmentRepo.count({
        where: {
          id: In(enrolmentIds),
          organisationId,
          employerOrganisationId: dto.employerOrganisationId,
          isDeleted: false,
        },
      });
      if (valid !== enrolmentIds.length) {
        throw new BadRequestException(
          'One or more learners are not enrolled with this employer',
        );
      }
    }

    /**
     * The visit and its learner links are one fact, written in one
     * transaction. A visit that saved while its links failed would appear in
     * the log as an employer meeting that discussed nobody, which is worse
     * than the save having failed outright.
     */
    return this.dataSource.transaction(async (manager) => {
      const visit = await manager.save(
        manager.create(EmployerVisit, {
          organisationId,
          employerOrganisationId: dto.employerOrganisationId,
          visitedOn: dto.visitedOn,
          visitType: dto.visitType,
          attendees: dto.attendees.trim(),
          discussionPoints: dto.discussionPoints.trim(),
          actionPoints: dto.actionPoints?.trim() || null,
          nextVisitDate: dto.nextVisitDate ?? null,
          recordedByUserId: user.id,
        }),
      );

      if (enrolmentIds.length > 0) {
        await manager.save(
          enrolmentIds.map((enrolmentId) =>
            manager.create(EmployerVisitLearner, {
              organisationId,
              visitId: visit.id,
              enrolmentId,
            }),
          ),
        );
      }

      return visit;
    });
  }

  async list(
    user: AuthenticatedUser,
    query: ListEmployerVisitsQueryDto,
  ): Promise<{
    items: EmployerVisit[];
    learnersByVisit: Map<string, EmployerVisitLearner[]>;
    meta: IPaginationMeta;
  }> {
    const organisationId = user.organisationId!;
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const [items, total] = await this.visitRepo.findAndCount({
      where: {
        organisationId,
        isDeleted: false,
        ...(query.employerOrganisationId
          ? { employerOrganisationId: query.employerOrganisationId }
          : {}),
      },
      relations: ['employerOrganisation'],
      // Newest visit first, with an id tiebreak: several visits can share a
      // date, and without it a row can appear on two pages and another on none.
      order: { visitedOn: 'DESC', id: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    const learnersByVisit = new Map<string, EmployerVisitLearner[]>();
    if (items.length > 0) {
      const links = await this.linkRepo.find({
        where: { organisationId, visitId: In(items.map((v) => v.id)) },
        relations: ['enrolment', 'enrolment.apprentice'],
      });
      for (const link of links) {
        const list = learnersByVisit.get(link.visitId) ?? [];
        list.push(link);
        learnersByVisit.set(link.visitId, list);
      }
    }

    return {
      items,
      learnersByVisit,
      meta: buildPaginationMeta({ total, page, perPage }),
    };
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<{ visit: EmployerVisit; learners: EmployerVisitLearner[] }> {
    const visit = await this.visitRepo.findOne({
      where: { id, organisationId: user.organisationId!, isDeleted: false },
      relations: ['employerOrganisation'],
    });
    if (!visit) {
      throw new NotFoundException('Employer visit not found');
    }

    const learners = await this.linkRepo.find({
      where: { organisationId: user.organisationId!, visitId: id },
      relations: ['enrolment', 'enrolment.apprentice'],
    });

    return { visit, learners };
  }

  /**
   * F2.4.2 AC4 — what date to offer for the next visit.
   *
   * Suggested from the last visit rather than from today: a tutor recording a
   * visit three weeks late should be offered a date that keeps the twelve-week
   * rhythm, not one that quietly pushes every future visit back by the delay.
   *
   * Returns today's suggestion when there is no history, because a first visit
   * has nothing to count from.
   */
  async suggestNextVisitDate(
    user: AuthenticatedUser,
    employerOrganisationId: string,
  ): Promise<{ lastVisitedOn: string | null; suggestedDate: string }> {
    const last = await this.visitRepo.findOne({
      where: {
        organisationId: user.organisationId!,
        employerOrganisationId,
        isDeleted: false,
      },
      order: { visitedOn: 'DESC' },
    });

    const anchor = last
      ? new Date(`${last.visitedOn}T00:00:00.000Z`)
      : new Date();
    anchor.setUTCDate(anchor.getUTCDate() + EMPLOYER_VISIT_INTERVAL_WEEKS * 7);

    return {
      lastVisitedOn: last?.visitedOn ?? null,
      suggestedDate: anchor.toISOString().slice(0, 10),
    };
  }

  /**
   * F2.4.1 — the directory's `lastVisitDate`, which was hardcoded `null` with
   * a note saying it was reserved for this feature.
   */
  async lastVisitDatesByEmployer(
    organisationId: string,
    employerOrganisationIds: string[],
  ): Promise<Map<string, string>> {
    if (employerOrganisationIds.length === 0) {
      return new Map();
    }

    const rows = await this.visitRepo
      .createQueryBuilder('v')
      .select('v.employerOrganisationId', 'employerOrganisationId')
      /**
       * Cast in SQL, deliberately.
       *
       * `MAX()` on a `date` column comes back through the driver as a JS
       * `Date` at *local* midnight. Formatting that with `toISOString()` then
       * shifts it back a day anywhere east of UTC — under BST, a visit on the
       * 15th reports as the 14th. Letting Postgres emit the text means no
       * `Date` is ever constructed and no timezone can be applied to a value
       * that has none.
       */
      .addSelect('MAX(v.visitedOn)::text', 'lastVisitedOn')
      .where('v.organisationId = :organisationId', { organisationId })
      .andWhere('v.isDeleted = false')
      .andWhere('v.employerOrganisationId IN (:...ids)', {
        ids: employerOrganisationIds,
      })
      .groupBy('v.employerOrganisationId')
      .getRawMany<{ employerOrganisationId: string; lastVisitedOn: string }>();

    return new Map(
      rows.map((row) => [
        row.employerOrganisationId,
        toDateOnly(row.lastVisitedOn),
      ]),
    );
  }
}
