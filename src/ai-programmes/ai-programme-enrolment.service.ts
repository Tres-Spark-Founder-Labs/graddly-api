import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ApprenticesService } from '../apprentices/apprentices.service.js';
import { ApprenticeStatus } from '../apprentices/enums/apprentice-status.enum.js';
import {
  getRlsBootstrap,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import { EnrolmentsService } from '../enrolments/enrolments.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { StandardStatus } from '../programmes/enums/standard-status.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { AiProgrammeCatalogueService } from './ai-programme-catalogue.service.js';
import { AiProgrammeEnrolmentResponseDto } from './dto/ai-programme-enrolment-response.dto.js';
import { CreateAiProgrammeEnrolmentDto } from './dto/create-ai-programme-enrolment.dto.js';
import { AiProgrammeModule } from './entities/ai-programme-module.entity.js';
import { AiProgrammeProgress } from './entities/ai-programme-progress.entity.js';
import { AiProgrammeModuleProgressStatus } from './enums/ai-programme-module-progress-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class AiProgrammeEnrolmentService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly catalogueService: AiProgrammeCatalogueService,
    private readonly apprenticesService: ApprenticesService,
    private readonly enrolmentsService: EnrolmentsService,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(Standard)
    private readonly standardRepo: Repository<Standard>,
    @InjectRepository(AiProgrammeProgress)
    private readonly progressRepo: Repository<AiProgrammeProgress>,
  ) {}

  async createEnrolment(
    user: AuthenticatedUser,
    dto: CreateAiProgrammeEnrolmentDto,
  ): Promise<AiProgrammeEnrolmentResponseDto> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(organisationId, PortalType.FLOW);

    const programme = await this.catalogueService.loadAiProgrammeById(
      dto.programmeId,
    );
    if (!programme) {
      throw new NotFoundException('AI programme not found in catalogue');
    }

    const standard = await this.loadPrimaryStandard(programme.id);
    if (!standard) {
      throw new BadRequestException(
        'AI programme has no active standard configured',
      );
    }

    const apprenticeId = await this.resolveApprenticeId(user, dto);
    await this.assertNoDuplicateEnrolment(
      organisationId,
      apprenticeId,
      standard.id,
    );

    const enrolment = this.enrolmentRepo.create({
      organisationId,
      apprenticeId,
      standardId: standard.id,
      status: EnrolmentStatus.DRAFT,
      plannedStartDate: dto.plannedStartDate ?? null,
      providerOrganisationId: programme.organisationId,
    });
    const saved = await this.enrolmentRepo.save(enrolment);

    const modules = await this.catalogueService.loadModulesForProgramme(
      programme.id,
    );
    await this.initializeProgressRows(organisationId, saved.id, modules);

    const activated = await this.enrolmentsService.activate(user, saved.id);

    return {
      enrolmentId: activated.id,
      apprenticeId,
      programmeId: programme.id,
      standardId: standard.id,
      providerOrganisationId: programme.organisationId,
      status: activated.status,
      progressModuleCount: modules.length,
    };
  }

  private async resolveApprenticeId(
    user: AuthenticatedUser,
    dto: CreateAiProgrammeEnrolmentDto,
  ): Promise<string> {
    if (dto.apprenticeId) {
      const apprentice = await this.apprenticesService.findOne(
        user,
        dto.apprenticeId,
      );
      return apprentice.id;
    }

    if (!dto.firstName || !dto.lastName || !dto.email) {
      throw new BadRequestException(
        'Provide apprenticeId or firstName, lastName, and email',
      );
    }

    const apprentice = await this.apprenticesService.create(user, {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      status: ApprenticeStatus.ACTIVE,
    });
    return apprentice.id;
  }

  private async assertNoDuplicateEnrolment(
    organisationId: string,
    apprenticeId: string,
    standardId: string,
  ): Promise<void> {
    const existing = await this.enrolmentRepo.findOne({
      where: {
        organisationId,
        apprenticeId,
        standardId,
        isDeleted: false,
      },
      order: { createdAt: 'DESC' },
    });

    if (
      existing &&
      (existing.status === EnrolmentStatus.DRAFT ||
        existing.status === EnrolmentStatus.ACTIVE)
    ) {
      throw new ConflictException(
        'An active or draft enrolment already exists for this apprentice and standard',
      );
    }
  }

  private async loadPrimaryStandard(
    programmeId: string,
  ): Promise<Standard | null> {
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    try {
      return this.standardRepo.findOne({
        where: {
          programmeId,
          status: StandardStatus.ACTIVE,
          isDeleted: false,
        },
        order: { createdAt: 'ASC' },
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }
  }

  private async initializeProgressRows(
    organisationId: string,
    enrolmentId: string,
    modules: AiProgrammeModule[],
  ): Promise<void> {
    if (modules.length === 0) {
      return;
    }

    const rows = modules.map((mod) =>
      this.progressRepo.create({
        organisationId,
        enrolmentId,
        moduleSlug: mod.slug,
        status: AiProgrammeModuleProgressStatus.NOT_STARTED,
        completedAt: null,
        metadata: null,
      }),
    );
    await this.progressRepo.save(rows);
  }
}
