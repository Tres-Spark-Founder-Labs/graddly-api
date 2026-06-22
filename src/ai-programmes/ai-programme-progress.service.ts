import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { ProgrammeDeliveryType } from '../programmes/enums/programme-delivery-type.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { AiProgrammeCatalogueService } from './ai-programme-catalogue.service.js';
import {
  AiProgrammeCompletionResponseDto,
  AiProgrammeProgressSummaryDto,
  UpdateAiProgrammeProgressDto,
} from './dto/ai-programme-enrolment-response.dto.js';
import { AiProgrammeCompletion } from './entities/ai-programme-completion.entity.js';
import { AiProgrammeModule } from './entities/ai-programme-module.entity.js';
import { AiProgrammeProgress } from './entities/ai-programme-progress.entity.js';
import { AiProgrammeModuleProgressStatus } from './enums/ai-programme-module-progress-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class AiProgrammeProgressService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly catalogueService: AiProgrammeCatalogueService,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(AiProgrammeProgress)
    private readonly progressRepo: Repository<AiProgrammeProgress>,
    @InjectRepository(AiProgrammeCompletion)
    private readonly completionRepo: Repository<AiProgrammeCompletion>,
  ) {}

  async getProgress(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<AiProgrammeProgressSummaryDto> {
    const { enrolment, programmeId, programmeTitle, modules, progressRows } =
      await this.loadAiEnrolmentContext(user, enrolmentId);

    const progressBySlug = new Map(
      progressRows.map((row) => [row.moduleSlug, row]),
    );

    const moduleDtos = modules.map((mod) => {
      const row = progressBySlug.get(mod.slug);
      return {
        moduleSlug: mod.slug,
        title: mod.title,
        status: row?.status ?? AiProgrammeModuleProgressStatus.NOT_STARTED,
        completedAt: row?.completedAt?.toISOString() ?? null,
        metadata: row?.metadata ?? null,
      };
    });

    return {
      enrolmentId: enrolment.id,
      enrolmentStatus: enrolment.status,
      programmeId,
      programmeTitle,
      percentComplete: this.calculatePercentComplete(moduleDtos),
      modules: moduleDtos,
    };
  }

  async upsertProgress(
    user: AuthenticatedUser,
    enrolmentId: string,
    dto: UpdateAiProgrammeProgressDto,
  ): Promise<AiProgrammeProgressSummaryDto> {
    const { enrolment, modules } = await this.loadAiEnrolmentContext(
      user,
      enrolmentId,
    );

    if (enrolment.status === EnrolmentStatus.COMPLETED) {
      throw new BadRequestException('Enrolment is already completed');
    }

    const module = modules.find((m) => m.slug === dto.moduleSlug);
    if (!module) {
      throw new NotFoundException('Module not found for this AI programme');
    }

    const status = this.parseStatus(dto.status);
    let row = await this.progressRepo.findOne({
      where: {
        enrolmentId,
        moduleSlug: dto.moduleSlug,
        isDeleted: false,
      },
    });

    if (!row) {
      row = this.progressRepo.create({
        organisationId: enrolment.organisationId,
        enrolmentId,
        moduleSlug: dto.moduleSlug,
        status,
        completedAt:
          status === AiProgrammeModuleProgressStatus.COMPLETED
            ? new Date()
            : null,
        metadata: dto.metadata ?? null,
      });
    } else {
      row.status = status;
      row.completedAt =
        status === AiProgrammeModuleProgressStatus.COMPLETED
          ? (row.completedAt ?? new Date())
          : null;
      if (dto.metadata !== undefined) {
        row.metadata = dto.metadata;
      }
    }

    await this.progressRepo.save(row);
    return this.getProgress(user, enrolmentId);
  }

  async completeEnrolment(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<AiProgrammeCompletionResponseDto> {
    const context = await this.loadAiEnrolmentContext(user, enrolmentId);
    const { enrolment, modules, progressRows } = context;

    if (enrolment.status === EnrolmentStatus.COMPLETED) {
      const existing = await this.completionRepo.findOne({
        where: { enrolmentId, isDeleted: false },
      });
      return {
        enrolmentId,
        enrolmentStatus: EnrolmentStatus.COMPLETED,
        completedAt: (
          existing?.completedAt ??
          enrolment.completedAt ??
          new Date()
        ).toISOString(),
        summary: existing?.summary ?? null,
      };
    }

    const progressBySlug = new Map(
      progressRows.map((row) => [row.moduleSlug, row]),
    );
    const incomplete = modules.filter((mod) => {
      const row = progressBySlug.get(mod.slug);
      return row?.status !== AiProgrammeModuleProgressStatus.COMPLETED;
    });

    if (incomplete.length > 0) {
      throw new BadRequestException(
        `All modules must be completed before finishing the programme (${incomplete.length} remaining)`,
      );
    }

    const completedAt = new Date();
    enrolment.status = EnrolmentStatus.COMPLETED;
    enrolment.completedAt = completedAt;
    await this.enrolmentRepo.save(enrolment);

    const summary = {
      programmeId: context.programmeId,
      programmeTitle: context.programmeTitle,
      moduleCount: modules.length,
      completedModuleSlugs: modules.map((m) => m.slug),
    };

    let completion = await this.completionRepo.findOne({
      where: { enrolmentId, isDeleted: false },
    });
    if (!completion) {
      completion = this.completionRepo.create({
        organisationId: enrolment.organisationId,
        enrolmentId,
        completedAt,
        summary,
      });
    } else {
      completion.completedAt = completedAt;
      completion.summary = summary;
    }
    await this.completionRepo.save(completion);

    return {
      enrolmentId,
      enrolmentStatus: EnrolmentStatus.COMPLETED,
      completedAt: completedAt.toISOString(),
      summary,
    };
  }

  private async loadAiEnrolmentContext(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<{
    enrolment: Enrolment;
    programmeId: string;
    programmeTitle: string;
    modules: AiProgrammeModule[];
    progressRows: AiProgrammeProgress[];
  }> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(organisationId, PortalType.FLOW);

    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    let enrolment: Enrolment | null;
    try {
      enrolment = await this.enrolmentRepo.findOne({
        where: { id: enrolmentId, organisationId, isDeleted: false },
        relations: ['standard', 'standard.programme'],
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }

    if (!enrolment?.standard?.programme) {
      throw new NotFoundException('Enrolment not found');
    }

    const programme = enrolment.standard.programme;
    if (programme.deliveryType !== ProgrammeDeliveryType.FLOWPORTAL_AI) {
      throw new BadRequestException(
        'Enrolment is not on the FlowPortal AI track',
      );
    }

    const modules = await this.catalogueService.loadModulesForProgramme(
      programme.id,
    );
    const progressRows = await this.progressRepo.find({
      where: { enrolmentId, isDeleted: false },
      order: { moduleSlug: 'ASC' },
    });

    return {
      enrolment,
      programmeId: programme.id,
      programmeTitle: programme.title,
      modules,
      progressRows,
    };
  }

  private calculatePercentComplete(
    modules: { status: AiProgrammeModuleProgressStatus }[],
  ): number {
    if (modules.length === 0) {
      return 0;
    }
    const completed = modules.filter(
      (m) => m.status === AiProgrammeModuleProgressStatus.COMPLETED,
    ).length;
    return Math.round((completed / modules.length) * 100);
  }

  private parseStatus(
    status: UpdateAiProgrammeProgressDto['status'],
  ): AiProgrammeModuleProgressStatus {
    if (!Object.values(AiProgrammeModuleProgressStatus).includes(status)) {
      throw new BadRequestException('Invalid module progress status');
    }
    return status;
  }
}
