import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';

import { CommitmentPipelineService } from './commitment-pipeline.service.js';
import { CommitmentPipelineStatus } from './enums/commitment-pipeline-status.enum.js';

describe('CommitmentPipelineService', () => {
  let service: CommitmentPipelineService;

  const enrolmentRepo = {
    find: jest.fn(),
  };
  const commitmentGroupRepo = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommitmentPipelineService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: commitmentGroupRepo,
        },
      ],
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

  it('maps commitment statement entity to pipeline status', () => {
    expect(
      service.mapFromStatement({
        status: CommitmentStatementStatus.SIGNED,
      } as never),
    ).toBe(CommitmentPipelineStatus.SIGNED);
    expect(service.mapFromStatement(null)).toBe(CommitmentPipelineStatus.NONE);
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

  it('counts pipeline statuses for active enrolments', async () => {
    enrolmentRepo.find.mockResolvedValue([
      { id: 'e1', status: EnrolmentStatus.ACTIVE },
      { id: 'e2', status: EnrolmentStatus.ACTIVE },
    ]);
    commitmentGroupRepo.find.mockResolvedValue([
      {
        enrolmentId: 'e1',
        currentVersion: { status: CommitmentStatementStatus.SIGNED },
      },
    ]);

    const counts = await service.countByPipelineStatus('org-1');

    expect(counts[CommitmentPipelineStatus.SIGNED]).toBe(1);
    expect(counts[CommitmentPipelineStatus.NONE]).toBe(1);
  });
});
