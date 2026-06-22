import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { QUEUE_EPA_PACK } from '../bullmq/bullmq.constants.js';

import { EpaPackJob } from './entities/epa-pack-job.entity.js';
import { EpaPackJobStatus } from './enums/epa-pack-job-status.enum.js';
import { EpaPackDispatchService } from './epa-pack-dispatch.service.js';
import { EPA_PACK_JOB_BUILD } from './epa-pack.constants.js';

describe('EpaPackDispatchService', () => {
  const queueAdd = jest.fn();
  const create = jest.fn();
  const save = jest.fn();

  let service: EpaPackDispatchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    queueAdd.mockResolvedValue(undefined);
    create.mockImplementation((value: EpaPackJob) => value);
    save.mockImplementation((value: EpaPackJob) => Promise.resolve(value));

    const moduleRef = await Test.createTestingModule({
      providers: [
        EpaPackDispatchService,
        {
          provide: getQueueToken(QUEUE_EPA_PACK),
          useValue: { add: queueAdd },
        },
        {
          provide: getRepositoryToken(EpaPackJob),
          useValue: { create, save },
        },
      ],
    }).compile();

    service = moduleRef.get(EpaPackDispatchService);
  });

  describe('enqueue', () => {
    it('creates a queued job and enqueues BullMQ work', async () => {
      const result = await service.enqueue('org-1', 'user-1', {
        enrolmentId: 'enrol-1',
      });

      expect(result.status).toBe(EpaPackJobStatus.QUEUED);
      expect(result.enrolmentId).toBe('enrol-1');
      expect(result.id).toEqual(expect.any(String));
      expect(save).toHaveBeenCalled();
      expect(queueAdd).toHaveBeenCalledWith(
        EPA_PACK_JOB_BUILD,
        expect.objectContaining({
          jobId: result.id,
          organisationId: 'org-1',
          userId: 'user-1',
          enrolmentId: 'enrol-1',
        }),
        expect.objectContaining({ jobId: result.id }),
      );
    });
  });
});
