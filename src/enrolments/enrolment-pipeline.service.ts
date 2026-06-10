import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrolment } from './entities/enrolment.entity.js';
import {
  ENROLMENT_PIPELINE_ORDER,
  EnrolmentPipelineState,
} from './enums/enrolment-pipeline-state.enum.js';

@Injectable()
export class EnrolmentPipelineService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
  ) {}

  resolveDisplayState(enrolment: Enrolment): EnrolmentPipelineState | null {
    return enrolment.pipelineState ?? null;
  }

  async advanceIfAhead(
    enrolmentId: string,
    targetState: EnrolmentPipelineState,
  ): Promise<Enrolment | null> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, isDeleted: false },
    });
    if (!enrolment) {
      return null;
    }

    const targetOrder = ENROLMENT_PIPELINE_ORDER[targetState];
    const currentOrder = enrolment.pipelineState
      ? ENROLMENT_PIPELINE_ORDER[enrolment.pipelineState]
      : 0;

    if (currentOrder >= targetOrder) {
      return enrolment;
    }

    enrolment.pipelineState = targetState;
    const now = new Date();
    switch (targetState) {
      case EnrolmentPipelineState.INVITED:
        enrolment.pipelineInvitedAt = now;
        break;
      case EnrolmentPipelineState.ACCOUNT_CREATED:
        enrolment.pipelineAccountCreatedAt = now;
        break;
      case EnrolmentPipelineState.PROVIDER_ACCEPTED:
        enrolment.pipelineProviderAcceptedAt = now;
        break;
      case EnrolmentPipelineState.ILR_CREATED:
        enrolment.pipelineIlrCreatedAt = now;
        break;
      case EnrolmentPipelineState.DAS_CONFIRMED:
        enrolment.pipelineDasConfirmedAt = now;
        break;
      default:
        break;
    }

    return this.enrolmentRepo.save(enrolment);
  }

  isAtLeast(
    state: EnrolmentPipelineState | null,
    minimum: EnrolmentPipelineState,
  ): boolean {
    if (!state) {
      return false;
    }
    return ENROLMENT_PIPELINE_ORDER[state] >= ENROLMENT_PIPELINE_ORDER[minimum];
  }
}
