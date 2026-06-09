import { Injectable } from '@nestjs/common';

import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';

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
}
