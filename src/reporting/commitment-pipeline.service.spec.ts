import { Test } from '@nestjs/testing';

import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { CommitmentPipelineStatus } from './enums/commitment-pipeline-status.enum.js';

describe('CommitmentPipelineService', () => {
  let service: CommitmentPipelineService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CommitmentPipelineService],
    }).compile();

    service = moduleRef.get(CommitmentPipelineService);
  });

  it('maps statement statuses to pipeline labels', () => {
    expect(service.mapStatementStatus(CommitmentStatementStatus.DRAFT)).toBe(
      CommitmentPipelineStatus.DRAFT,
    );
    expect(
      service.mapStatementStatus(CommitmentStatementStatus.AWAITING_SIGNATURES),
    ).toBe(CommitmentPipelineStatus.AWAITING_SIGNATURES);
    expect(service.mapStatementStatus(CommitmentStatementStatus.SIGNED)).toBe(
      CommitmentPipelineStatus.SIGNED,
    );
    expect(
      service.mapStatementStatus(CommitmentStatementStatus.CANCELLED),
    ).toBe(CommitmentPipelineStatus.CANCELLED);
    expect(service.mapStatementStatus(undefined)).toBe(
      CommitmentPipelineStatus.NONE,
    );
  });

  it('returns the most advanced pipeline status', () => {
    expect(
      service.mostAdvanced([
        CommitmentPipelineStatus.DRAFT,
        CommitmentPipelineStatus.SIGNED,
        CommitmentPipelineStatus.NONE,
      ]),
    ).toBe(CommitmentPipelineStatus.SIGNED);
  });
});
