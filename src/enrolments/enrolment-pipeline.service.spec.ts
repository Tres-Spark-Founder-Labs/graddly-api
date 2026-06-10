import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EnrolmentPipelineService } from './enrolment-pipeline.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EnrolmentPipelineState } from './enums/enrolment-pipeline-state.enum.js';

describe('EnrolmentPipelineService', () => {
  let service: EnrolmentPipelineService;
  const enrolmentFindOne = jest.fn();
  const enrolmentSave = jest.fn((value: Enrolment) => Promise.resolve(value));

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrolmentPipelineService,
        {
          provide: getRepositoryToken(Enrolment),
          useValue: {
            findOne: enrolmentFindOne,
            save: enrolmentSave,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(EnrolmentPipelineService);
    jest.clearAllMocks();
  });

  it('advances pipeline state forward and sets timestamp', async () => {
    enrolmentFindOne.mockResolvedValue({
      id: 'enr-1',
      pipelineState: null,
    });

    await service.advanceIfAhead('enr-1', EnrolmentPipelineState.INVITED);

    const calls = enrolmentSave.mock.calls as [Enrolment][];
    const saved = calls[0]?.[0];
    expect(saved?.pipelineState).toBe(EnrolmentPipelineState.INVITED);
    expect(saved?.pipelineInvitedAt).toBeInstanceOf(Date);
  });

  it('does not regress pipeline state', async () => {
    enrolmentFindOne.mockResolvedValue({
      id: 'enr-1',
      pipelineState: EnrolmentPipelineState.ILR_CREATED,
      pipelineIlrCreatedAt: new Date('2026-01-01'),
    });

    const result = await service.advanceIfAhead(
      'enr-1',
      EnrolmentPipelineState.PROVIDER_ACCEPTED,
    );

    expect(enrolmentSave).not.toHaveBeenCalled();
    expect(result?.pipelineState).toBe(EnrolmentPipelineState.ILR_CREATED);
  });

  it('is idempotent when target state already reached', async () => {
    enrolmentFindOne.mockResolvedValue({
      id: 'enr-1',
      pipelineState: EnrolmentPipelineState.ACCOUNT_CREATED,
    });

    await service.advanceIfAhead(
      'enr-1',
      EnrolmentPipelineState.ACCOUNT_CREATED,
    );

    expect(enrolmentSave).not.toHaveBeenCalled();
  });

  it('isAtLeast compares pipeline ordinals', () => {
    expect(
      service.isAtLeast(
        EnrolmentPipelineState.PROVIDER_ACCEPTED,
        EnrolmentPipelineState.ACCOUNT_CREATED,
      ),
    ).toBe(true);
    expect(
      service.isAtLeast(
        EnrolmentPipelineState.INVITED,
        EnrolmentPipelineState.ACCOUNT_CREATED,
      ),
    ).toBe(false);
    expect(service.isAtLeast(null, EnrolmentPipelineState.INVITED)).toBe(false);
  });
});
