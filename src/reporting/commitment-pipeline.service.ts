import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';

import { CommitmentPipelineStatus } from './enums/commitment-pipeline-status.enum.js';

const PIPELINE_RANK: Record<CommitmentPipelineStatus, number> = {
  [CommitmentPipelineStatus.CANCELLED]: 0,
  [CommitmentPipelineStatus.NONE]: 1,
  [CommitmentPipelineStatus.DRAFT]: 2,
  [CommitmentPipelineStatus.AWAITING_SIGNATURES]: 3,
  [CommitmentPipelineStatus.SIGNED]: 4,
};

@Injectable()
export class CommitmentPipelineService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(CommitmentStatementGroup)
    private readonly commitmentGroupRepo: Repository<CommitmentStatementGroup>,
  ) {}
  mapStatementStatus(
    status: CommitmentStatementStatus | null | undefined,
  ): CommitmentPipelineStatus {
    if (!status) {
      return CommitmentPipelineStatus.NONE;
    }

    switch (status) {
      case CommitmentStatementStatus.DRAFT:
      case CommitmentStatementStatus.SUBMITTED:
        return CommitmentPipelineStatus.DRAFT;
      case CommitmentStatementStatus.AWAITING_SIGNATURES:
        return CommitmentPipelineStatus.AWAITING_SIGNATURES;
      case CommitmentStatementStatus.SIGNED:
        return CommitmentPipelineStatus.SIGNED;
      case CommitmentStatementStatus.CANCELLED:
        return CommitmentPipelineStatus.CANCELLED;
      case CommitmentStatementStatus.SUPERSEDED:
      default:
        return CommitmentPipelineStatus.NONE;
    }
  }

  mapFromStatement(
    statement: CommitmentStatement | null | undefined,
  ): CommitmentPipelineStatus {
    return this.mapStatementStatus(statement?.status);
  }

  /** Returns the most advanced pipeline status across a set. */
  mostAdvanced(statuses: CommitmentPipelineStatus[]): CommitmentPipelineStatus {
    if (statuses.length === 0) {
      return CommitmentPipelineStatus.NONE;
    }

    return statuses.reduce((best, current) =>
      PIPELINE_RANK[current] > PIPELINE_RANK[best] ? current : best,
    );
  }

  emptyCounts(): Record<CommitmentPipelineStatus, number> {
    return {
      [CommitmentPipelineStatus.NONE]: 0,
      [CommitmentPipelineStatus.DRAFT]: 0,
      [CommitmentPipelineStatus.AWAITING_SIGNATURES]: 0,
      [CommitmentPipelineStatus.SIGNED]: 0,
      [CommitmentPipelineStatus.CANCELLED]: 0,
    };
  }

  incrementCount(
    counts: Record<CommitmentPipelineStatus, number>,
    status: CommitmentPipelineStatus,
  ): void {
    counts[status] += 1;
  }

  async countByPipelineStatus(
    organisationId: string,
  ): Promise<Record<CommitmentPipelineStatus, number>> {
    const counts = this.emptyCounts();
    const enrolments = await this.enrolmentRepo.find({
      where: {
        organisationId,
        status: EnrolmentStatus.ACTIVE,
        isDeleted: false,
      },
    });

    if (enrolments.length === 0) {
      return counts;
    }

    const groups = await this.commitmentGroupRepo.find({
      where: {
        organisationId,
        enrolmentId: In(enrolments.map((e) => e.id)),
        isDeleted: false,
      },
      relations: ['currentVersion'],
    });
    const groupByEnrolment = new Map(groups.map((g) => [g.enrolmentId, g]));

    for (const enrolment of enrolments) {
      const status = this.mapFromStatement(
        groupByEnrolment.get(enrolment.id)?.currentVersion,
      );
      this.incrementCount(counts, status);
    }

    return counts;
  }
}
