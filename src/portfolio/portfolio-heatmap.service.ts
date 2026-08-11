import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LearnerScopeService } from '../common/learner-scope/learner-scope.service.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import { KsbCoverageResponseDto } from './dto/ksb-coverage-response.dto.js';
import {
  KsbHeatmapCellResponseDto,
  KsbHeatmapResponseDto,
} from './dto/ksb-heatmap-response.dto.js';
import { UpsertKsbCoverageDto } from './dto/upsert-ksb-coverage.dto.js';
import { EnrolmentKsbCoverage } from './entities/enrolment-ksb-coverage.entity.js';
import { KsEvidenceStatus } from './enums/ks-evidence-status.enum.js';
import { KsbHeatmapStrength } from './enums/ksb-heatmap-strength.enum.js';
import { KsbDefinitionsService } from './ksb-definitions.service.js';
import { PortfolioEnrolmentContext } from './portfolio-enrolment.context.js';
import { PortfolioHeatmapCacheService } from './portfolio-heatmap-cache.service.js';
import { HEATMAP_STRENGTH_ADEQUATE_MIN } from './portfolio.constants.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

interface IAcceptedEvidenceRow {
  ksbDefinitionId: string;
  evidenceItemId: string;
}

@Injectable()
export class PortfolioHeatmapService {
  constructor(
    @InjectRepository(EnrolmentKsbCoverage)
    private readonly coverageRepo: Repository<EnrolmentKsbCoverage>,
    private readonly enrolmentContext: PortfolioEnrolmentContext,
    private readonly ksbDefinitionsService: KsbDefinitionsService,
    private readonly heatmapCache: PortfolioHeatmapCacheService,
    private readonly learnerScope: LearnerScopeService,
  ) {}

  async getHeatmap(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<KsbHeatmapResponseDto> {
    const organisationId = user.organisationId!;

    /**
     * D3 — the heatmap is a per-learner competence picture, and `enrolmentId`
     * arrives from the client. Checked before the cache read, because a cache
     * hit would otherwise return another learner's cells without ever reaching
     * the org check below.
     */
    const ownEnrolmentIds = await this.learnerScope.ownEnrolmentIds(user);
    if (ownEnrolmentIds !== null && !ownEnrolmentIds.includes(enrolmentId)) {
      throw new NotFoundException('Enrolment not found');
    }
    const cached = await this.heatmapCache.get(organisationId, enrolmentId);
    if (cached) {
      return { enrolmentId, cells: cached };
    }

    const enrolment = await this.enrolmentContext.requireEnrolment(
      organisationId,
      enrolmentId,
    );
    const definitions = await this.ksbDefinitionsService.findByStandard(
      user,
      enrolment.standardId,
    );

    const acceptedRows = await this.fetchAcceptedEvidenceRows(
      organisationId,
      enrolmentId,
    );
    const countByKsb = new Map<string, string[]>();
    for (const row of acceptedRows) {
      const list = countByKsb.get(row.ksbDefinitionId) ?? [];
      if (!list.includes(row.evidenceItemId)) {
        list.push(row.evidenceItemId);
      }
      countByKsb.set(row.ksbDefinitionId, list);
    }

    const coverageRows = await this.coverageRepo.find({
      where: { organisationId, enrolmentId },
    });
    const coverageByKsb = new Map(
      coverageRows.map((c) => [c.ksbDefinitionId, c.assessment]),
    );

    const cells: KsbHeatmapCellResponseDto[] = definitions.map((def) => {
      const evidenceItemIds = countByKsb.get(def.id) ?? [];
      const evidenceCount = evidenceItemIds.length;
      return {
        ksbDefinitionId: def.id,
        code: def.code,
        kind: def.kind,
        title: def.title,
        evidenceCount,
        strength: this.strengthFromCount(evidenceCount),
        tutorAssessment: coverageByKsb.get(def.id) ?? null,
        evidenceItemIds,
      };
    });

    await this.heatmapCache.set(organisationId, enrolmentId, cells);
    return { enrolmentId, cells };
  }

  async upsertCoverage(
    user: AuthenticatedUser,
    enrolmentId: string,
    ksbDefinitionId: string,
    dto: UpsertKsbCoverageDto,
  ): Promise<KsbCoverageResponseDto> {
    this.assertTutorOrAdmin(user);
    const organisationId = user.organisationId!;
    const enrolment = await this.enrolmentContext.requireEnrolment(
      organisationId,
      enrolmentId,
    );
    await this.ksbDefinitionsService.findEntitiesForStandard(
      organisationId,
      enrolment.standardId,
      [ksbDefinitionId],
    );

    let row = await this.coverageRepo.findOne({
      where: { organisationId, enrolmentId, ksbDefinitionId },
    });
    if (!row) {
      row = this.coverageRepo.create({
        organisationId,
        enrolmentId,
        ksbDefinitionId,
        assessment: dto.assessment,
        assessedByUserId: user.id,
        assessedAt: new Date(),
      });
    } else {
      row.assessment = dto.assessment;
      row.assessedByUserId = user.id;
      row.assessedAt = new Date();
    }
    const saved = await this.coverageRepo.save(row);
    await this.heatmapCache.invalidate(organisationId, enrolmentId);
    return {
      enrolmentId: saved.enrolmentId,
      ksbDefinitionId: saved.ksbDefinitionId,
      assessment: saved.assessment,
      assessedByUserId: saved.assessedByUserId,
      assessedAt: saved.assessedAt.toISOString(),
    };
  }

  private strengthFromCount(count: number): KsbHeatmapStrength {
    if (count <= 0) return KsbHeatmapStrength.NONE;
    if (count < HEATMAP_STRENGTH_ADEQUATE_MIN) return KsbHeatmapStrength.LOW;
    return KsbHeatmapStrength.ADEQUATE;
  }

  private async fetchAcceptedEvidenceRows(
    organisationId: string,
    enrolmentId: string,
  ): Promise<IAcceptedEvidenceRow[]> {
    const rows = await this.coverageRepo.manager
      .createQueryBuilder()
      .select('map.ksbDefinitionId', 'ksbDefinitionId')
      .addSelect('item.id', 'evidenceItemId')
      .from('ks_evidence_ksb_mappings', 'map')
      .innerJoin('ks_evidence_items', 'item', 'item.id = map.evidenceItemId')
      .where('item.organisationId = :organisationId', { organisationId })
      .andWhere('item.enrolmentId = :enrolmentId', { enrolmentId })
      .andWhere('item.status = :status', { status: KsEvidenceStatus.ACCEPTED })
      .andWhere('item.isDeleted = false')
      .getRawMany<IAcceptedEvidenceRow>();
    return rows;
  }

  private assertTutorOrAdmin(user: AuthenticatedUser): void {
    const roles = user.roles ?? [];
    if (
      !roles.includes(OrganisationRole.OWNER) &&
      !roles.includes(OrganisationRole.ADMIN)
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }
}
