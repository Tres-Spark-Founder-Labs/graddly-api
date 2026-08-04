import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { EmployerVisitsService } from '../employer-visits/employer-visits.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { OtjProgressMetricsService } from './otj-progress-metrics.service.js';
import { ReportingPortalService } from './reporting-portal.service.js';

import type { EmployerDirectoryEntryResponseDto } from './dto/employer-directory-entry-response.dto.js';
import type { ListEmployerDirectoryQueryDto } from './dto/list-reporting-query.dto.js';

interface IEmployerAggregate {
  employerOrganisationId: string;
  activeEnrolmentIds: string[];
}

@Injectable()
export class EmployerDirectoryService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly otjMetricsService: OtjProgressMetricsService,
    private readonly pipelineService: CommitmentPipelineService,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(CommitmentStatementGroup)
    private readonly commitmentGroupRepo: Repository<CommitmentStatementGroup>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    // F2.4.1 — supplies lastVisitDate, which shipped as a hardcoded null
    // until the visit log (F2.4.2) existed to fill it.
    @Inject(forwardRef(() => EmployerVisitsService))
    private readonly employerVisitsService: EmployerVisitsService,
  ) {}

  async list(
    providerOrganisationId: string,
    query: ListEmployerDirectoryQueryDto,
  ): Promise<PaginatedResult<EmployerDirectoryEntryResponseDto>> {
    await this.portalService.assertPortalType(
      providerOrganisationId,
      PortalType.PROVIDER,
    );

    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const enrolments = await this.enrolmentRepo.find({
      where: {
        organisationId: providerOrganisationId,
        isDeleted: false,
      },
    });

    const linked = enrolments.filter((e) => e.employerOrganisationId);
    const aggregates = this.buildAggregates(linked);
    const employerIds = [...aggregates.keys()];

    const [employers, memberships, commitmentGroups, lastVisitDates] =
      await Promise.all([
        this.loadEmployers(employerIds),
        this.loadOwnerMemberships(employerIds),
        this.loadCommitmentGroups(providerOrganisationId, linked),
        // F2.4.1 — one grouped query for every employer on the page, rather
        // than a lookup inside the loop below.
        this.employerVisitsService.lastVisitDatesByEmployer(
          providerOrganisationId,
          employerIds,
        ),
      ]);

    const employerMap = new Map(employers.map((org) => [org.id, org]));
    const membershipMap = new Map(
      memberships.map((membership) => [membership.organisation.id, membership]),
    );
    const commitmentByEnrolment = new Map(
      commitmentGroups.map((group) => [group.enrolmentId, group]),
    );

    let rows: EmployerDirectoryEntryResponseDto[] = [];
    for (const [employerId, aggregate] of aggregates) {
      const employer = employerMap.get(employerId);
      if (!employer) {
        continue;
      }

      const activeIds = aggregate.activeEnrolmentIds;
      const pipelineStatuses = activeIds.map((enrolmentId) => {
        const group = commitmentByEnrolment.get(enrolmentId);
        return this.pipelineService.mapFromStatement(group?.currentVersion);
      });

      const ownerMembership = membershipMap.get(employerId);
      const contactName = ownerMembership
        ? `${ownerMembership.user.firstName} ${ownerMembership.user.lastName}`
        : null;
      const contactEmail =
        ownerMembership?.user.email ?? employer.orgEmail ?? '';

      rows.push({
        employerOrganisationId: employerId,
        organisationName: employer.name,
        contactName,
        contactEmail,
        activeLearnerCount: activeIds.length,
        averageOtjPercent:
          await this.otjMetricsService.averageOtjPercentForEnrolments(
            providerOrganisationId,
            activeIds,
          ),
        commitmentPipelineStatus:
          this.pipelineService.mostAdvanced(pipelineStatuses),
        /**
         * F2.4.1 / F2.4.2. This was a hardcoded `null` carrying an honest note
         * ("Reserved for employer visit log") — the field could not hold a
         * value because nothing recorded visits. It can now.
         *
         * Still null for an employer never visited, which is a real and
         * important state rather than missing data: it is the first thing a
         * provider preparing for inspection wants to filter on.
         */
        lastVisitDate: lastVisitDates.get(employerId) ?? null,
        region: employer.city ?? null,
      });
    }

    rows = this.applyFilters(rows, query);
    rows.sort((a, b) => a.organisationName.localeCompare(b.organisationName));

    const total = rows.length;
    const start = (page - 1) * perPage;
    const items = rows.slice(start, start + perPage);

    return new PaginatedResult(
      items,
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  private buildAggregates(
    enrolments: Enrolment[],
  ): Map<string, IEmployerAggregate> {
    const map = new Map<string, IEmployerAggregate>();

    for (const enrolment of enrolments) {
      const employerId = enrolment.employerOrganisationId!;
      const existing = map.get(employerId) ?? {
        employerOrganisationId: employerId,
        activeEnrolmentIds: [],
      };

      if (enrolment.status === EnrolmentStatus.ACTIVE) {
        existing.activeEnrolmentIds.push(enrolment.id);
      }

      map.set(employerId, existing);
    }

    return map;
  }

  private applyFilters(
    rows: EmployerDirectoryEntryResponseDto[],
    query: ListEmployerDirectoryQueryDto,
  ): EmployerDirectoryEntryResponseDto[] {
    let filtered = rows;

    if (query.region) {
      const needle = query.region.toLowerCase();
      filtered = filtered.filter((row) =>
        (row.region ?? '').toLowerCase().includes(needle),
      );
    }

    if (query.minActiveLearners !== undefined) {
      filtered = filtered.filter(
        (row) => row.activeLearnerCount >= query.minActiveLearners!,
      );
    }

    if (query.minAverageOtjPercent !== undefined) {
      filtered = filtered.filter(
        (row) =>
          row.averageOtjPercent !== null &&
          row.averageOtjPercent >= query.minAverageOtjPercent!,
      );
    }

    return filtered;
  }

  private async loadEmployers(employerIds: string[]): Promise<Organisation[]> {
    if (employerIds.length === 0) {
      return [];
    }

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      return this.organisationRepo.findBy({
        id: In(employerIds),
        isDeleted: false,
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async loadOwnerMemberships(
    employerIds: string[],
  ): Promise<OrganisationMembership[]> {
    if (employerIds.length === 0) {
      return [];
    }

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      return this.membershipRepo.find({
        where: {
          organisation: { id: In(employerIds) },
          role: OrganisationRole.OWNER,
          isDeleted: false,
        },
        relations: ['user', 'organisation'],
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async loadCommitmentGroups(
    providerOrganisationId: string,
    enrolments: Enrolment[],
  ): Promise<CommitmentStatementGroup[]> {
    const enrolmentIds = enrolments.map((e) => e.id);
    if (enrolmentIds.length === 0) {
      return [];
    }

    return this.commitmentGroupRepo.find({
      where: {
        organisationId: providerOrganisationId,
        enrolmentId: In(enrolmentIds),
        isDeleted: false,
      },
      relations: ['currentVersion'],
    });
  }
}
