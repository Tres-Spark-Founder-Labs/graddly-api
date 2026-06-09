import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_DAS_SYNC } from '../bullmq/bullmq.constants.js';

import { DAS_JOB_SYNC_ORGANISATION } from './das-job.constants.js';
import { DasSyncDispatchService } from './das-sync-dispatch.service.js';

describe('DasSyncDispatchService', () => {
  const queueAdd = jest.fn();
  let service: DasSyncDispatchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    queueAdd.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        DasSyncDispatchService,
        {
          provide: getQueueToken(QUEUE_DAS_SYNC),
          useValue: { add: queueAdd },
        },
      ],
    }).compile();

    service = moduleRef.get(DasSyncDispatchService);
  });

  describe('enqueueSync', () => {
    it('enqueues a DAS sync job and returns the job id', async () => {
      const result = await service.enqueueSync({ organisationId: 'org-1' });

      expect(result.jobId).toEqual(expect.any(String));
      expect(queueAdd).toHaveBeenCalledWith(
        DAS_JOB_SYNC_ORGANISATION,
        { organisationId: 'org-1' },
        {
          ...bullmqDefaultJobOptions,
          jobId: result.jobId,
        },
      );
    });
  });
});
