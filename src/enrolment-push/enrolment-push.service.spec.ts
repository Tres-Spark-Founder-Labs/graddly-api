import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { buildEnrolmentGraphFixture } from '../ilr/testing/ilr-test-fixtures.js';

import { EnrolmentPushDispatchService } from './enrolment-push-dispatch.service.js';
import { EnrolmentPushService } from './enrolment-push.service.js';
import { EnrolmentSubmissionPush } from './entities/enrolment-submission-push.entity.js';
import { EnrolmentPushStatus } from './enums/enrolment-push-status.enum.js';
import { EnrolmentPushTrigger } from './enums/enrolment-push-trigger.enum.js';

/* eslint-disable @typescript-eslint/naming-convention -- ILR field keys */
describe('EnrolmentPushService', () => {
  const repo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
  };
  const dispatch = { enqueue: jest.fn() };
  let service: EnrolmentPushService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrolmentPushService,
        {
          provide: getRepositoryToken(EnrolmentSubmissionPush),
          useValue: repo,
        },
        {
          provide: EnrolmentPushDispatchService,
          useValue: dispatch,
        },
      ],
    }).compile();
    service = moduleRef.get(EnrolmentPushService);
    jest.clearAllMocks();
  });

  it('queues push from ILR record and dispatches job', async () => {
    repo.findOne.mockResolvedValue(null);
    repo.create.mockImplementation((input: unknown) => input);
    repo.save.mockResolvedValue({
      id: 'push-1',
      organisationId: 'org-1',
      status: EnrolmentPushStatus.QUEUED,
    });

    await service.queueFromIlrRecord({
      organisationId: 'org-1',
      graph: buildEnrolmentGraphFixture(),
      fields: { 'Learner.LearnRefNumber': 'LRN-1' },
      ilrLearnerRecordId: 'record-1',
      trigger: EnrolmentPushTrigger.ILR_CREATED,
      requestedByUserId: 'user-1',
    });

    expect(dispatch.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ pushId: 'push-1', organisationId: 'org-1' }),
    );
  });

  it('skips re-queue when already delivered', async () => {
    repo.findOne.mockResolvedValue({
      id: 'push-1',
      status: EnrolmentPushStatus.DELIVERED,
    });

    await service.queueFromIlrRecord({
      organisationId: 'org-1',
      graph: buildEnrolmentGraphFixture(),
      fields: {},
      ilrLearnerRecordId: 'record-1',
      trigger: EnrolmentPushTrigger.ILR_SUBMITTED,
    });

    expect(dispatch.enqueue).not.toHaveBeenCalled();
  });

  it('throws when retry target is missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.retryFailed({ id: 'u1', organisationId: 'org-1' } as never, 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
