import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { Programme } from '../programmes/entities/programme.entity.js';
import { ProgrammeDeliveryType } from '../programmes/enums/programme-delivery-type.enum.js';
import { ProgrammeStatus } from '../programmes/enums/programme-status.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import {
  AiProgrammeCatalogueEntryDto,
  AiProgrammeDetailDto,
  AiProgrammeModuleDto,
} from './dto/ai-programme-catalogue-response.dto.js';
import { AiProgrammeModule } from './entities/ai-programme-module.entity.js';

@Injectable()
export class AiProgrammeCatalogueService {
  constructor(
    private readonly portalService: ReportingPortalService,
    @InjectRepository(Programme)
    private readonly programmeRepo: Repository<Programme>,
    @InjectRepository(AiProgrammeModule)
    private readonly moduleRepo: Repository<AiProgrammeModule>,
  ) {}

  async listCatalogue(
    organisationId: string,
  ): Promise<AiProgrammeCatalogueEntryDto[]> {
    await this.portalService.assertPortalType(organisationId, PortalType.FLOW);

    const programmes = await this.loadActiveAiProgrammes();
    if (programmes.length === 0) {
      return [];
    }

    const programmeIds = programmes.map((p) => p.id);
    const modules = await this.loadModulesForProgrammes(programmeIds);
    const moduleCountByProgramme = new Map<string, number>();
    for (const mod of modules) {
      moduleCountByProgramme.set(
        mod.programmeId,
        (moduleCountByProgramme.get(mod.programmeId) ?? 0) + 1,
      );
    }

    return programmes.map((programme) => ({
      id: programme.id,
      code: programme.code,
      title: programme.title,
      description: programme.description,
      deliveryType: programme.deliveryType,
      moduleCount: moduleCountByProgramme.get(programme.id) ?? 0,
    }));
  }

  async getCatalogueDetail(
    organisationId: string,
    programmeId: string,
  ): Promise<AiProgrammeDetailDto> {
    await this.portalService.assertPortalType(organisationId, PortalType.FLOW);

    const programme = await this.loadAiProgrammeById(programmeId);
    if (!programme) {
      throw new NotFoundException('AI programme not found in catalogue');
    }

    const modules = await this.loadModulesForProgrammes([programmeId]);
    return {
      id: programme.id,
      code: programme.code,
      title: programme.title,
      description: programme.description,
      deliveryType: programme.deliveryType,
      moduleCount: modules.length,
      modules: modules.map((mod) => this.toModuleDto(mod)),
    };
  }

  async loadAiProgrammeById(programmeId: string): Promise<Programme | null> {
    const programmes = await this.loadActiveAiProgrammes();
    return programmes.find((p) => p.id === programmeId) ?? null;
  }

  async loadModulesForProgramme(
    programmeId: string,
  ): Promise<AiProgrammeModule[]> {
    return this.loadModulesForProgrammes([programmeId]);
  }

  private async loadActiveAiProgrammes(): Promise<Programme[]> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      return this.programmeRepo.find({
        where: {
          deliveryType: ProgrammeDeliveryType.FLOWPORTAL_AI,
          status: ProgrammeStatus.ACTIVE,
          isDeleted: false,
        },
        order: { title: 'ASC' },
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async loadModulesForProgrammes(
    programmeIds: string[],
  ): Promise<AiProgrammeModule[]> {
    if (programmeIds.length === 0) {
      return [];
    }

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      return this.moduleRepo
        .createQueryBuilder('mod')
        .where('mod.programmeId IN (:...programmeIds)', { programmeIds })
        .andWhere('mod.isDeleted = false')
        .orderBy('mod.sortOrder', 'ASC')
        .getMany();
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private toModuleDto(mod: AiProgrammeModule): AiProgrammeModuleDto {
    return {
      slug: mod.slug,
      title: mod.title,
      sortOrder: mod.sortOrder,
      description: mod.description,
    };
  }
}
