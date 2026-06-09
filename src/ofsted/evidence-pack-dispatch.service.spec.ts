import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { QUEUE_EVIDENCE_PACK } from '../bullmq/bullmq.constants.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';

import { EvidencePackJob } from './entities/evidence-pack-job.entity.js';
import { EvidencePackJobStatus } from './enums/evidence-pack-job-status.enum.js';
import { EvidencePackDispatchService } from './evidence-pack-dispatch.service.js';
import { EVIDENCE_PACK_JOB_BUILD } from './evidence-pack.constants.js';

describe('EvidencePackDispatchService', () => {
  const queueAdd = jest.fn();
  const create = jest.fn();
  const save = jest.fn();
  const belongsToOrganisation = jest.fn();

  let service: EvidencePackDispatchService;

  beforeEach(async () => {
    jest.clearAllMocks();
    queueAdd.mockResolvedValue(undefined);
    create.mockImplementation((value: EvidencePackJob) => value);
    save.mockImplementation((value: EvidencePackJob) => Promise.resolve(value));
    belongsToOrganisation.mockReturnValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EvidencePackDispatchService,
        {
          provide: getQueueToken(QUEUE_EVIDENCE_PACK),
          useValue: { add: queueAdd },
        },
        {
          provide: getRepositoryToken(EvidencePackJob),
          useValue: { create, save },
        },
        {
          provide: StorageKeyBuilder,
          useValue: { belongsToOrganisation },
        },
      ],
    }).compile();

    service = moduleRef.get(EvidencePackDispatchService);
  });

  describe('enqueue', () => {
    it('creates a queued job and enqueues BullMQ work', async () => {
      const result = await service.enqueue('org-1', 'user-1', {});

      expect(result.status).toBe(EvidencePackJobStatus.QUEUED);
      expect(result.id).toEqual(expect.any(String));
      expect(save).toHaveBeenCalled();
      expect(queueAdd).toHaveBeenCalledWith(
        EVIDENCE_PACK_JOB_BUILD,
        expect.objectContaining({
          jobId: result.id,
          organisationId: 'org-1',
          userId: 'user-1',
          additionalStorageKeys: [],
        }),
        expect.objectContaining({ jobId: result.id }),
      );
    });

    it('rejects storage keys outside the organisation', async () => {
      belongsToOrganisation.mockReturnValue(false);

      await expect(
        service.enqueue('org-1', 'user-1', {
          additionalStorageKeys: ['orgs/other/export/obj/file.pdf'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(queueAdd).not.toHaveBeenCalled();
    });
  });
});
