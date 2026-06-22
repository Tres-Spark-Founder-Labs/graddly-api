import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import { CreateInterventionActionDto } from './dto/create-intervention-action.dto.js';
import { InterventionActionResponseDto } from './dto/learner-provider-response.dto.js';
import { InterventionAction } from './entities/intervention-action.entity.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class InterventionActionsService {
  constructor(
    @InjectRepository(InterventionAction)
    private readonly repo: Repository<InterventionAction>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    private readonly portalService: ReportingPortalService,
  ) {}

  async create(
    user: AuthenticatedUser,
    enrolmentId: string,
    dto: CreateInterventionActionDto,
  ): Promise<InterventionActionResponseDto> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }

    const entity = this.repo.create({
      organisationId,
      enrolmentId,
      actionType: dto.actionType,
      notes: dto.notes?.trim() ?? null,
      createdByUserId: user.id,
    });
    const saved = await this.repo.save(entity);
    return this.toResponse(saved);
  }

  async listRecentForEnrolment(
    organisationId: string,
    enrolmentId: string,
    limit = 10,
  ): Promise<InterventionActionResponseDto[]> {
    const rows = await this.repo.find({
      where: { organisationId, enrolmentId, isDeleted: false },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows.map((row) => this.toResponse(row));
  }

  private toResponse(
    action: InterventionAction,
  ): InterventionActionResponseDto {
    return {
      id: action.id,
      enrolmentId: action.enrolmentId,
      actionType: action.actionType,
      notes: action.notes,
      createdByUserId: action.createdByUserId,
      createdAt: action.createdAt.toISOString(),
    };
  }
}
