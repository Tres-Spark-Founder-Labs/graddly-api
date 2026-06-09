import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { StorageService } from '../storage/storage.service.js';

import { EvidencePackJob } from './entities/evidence-pack-job.entity.js';
import { EvidencePackJobStatus } from './enums/evidence-pack-job-status.enum.js';
import { EvidencePackDispatchService } from './evidence-pack-dispatch.service.js';
import { EvidencePackJobsService } from './evidence-pack-jobs.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

const user = {
  id: 'user-1',
  organisationId: 'org-1',
} as AuthenticatedUser;

describe('EvidencePackJobsService', () => {
  const dispatch = { enqueue: jest.fn() };
  const storage = { createDownloadUrl: jest.fn() };
  const findOne = jest.fn();
  const jobRepo = { findOne };

  let service: EvidencePackJobsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EvidencePackJobsService,
        { provide: EvidencePackDispatchService, useValue: dispatch },
        { provide: StorageService, useValue: storage },
        {
          provide: getRepositoryToken(EvidencePackJob),
          useValue: jobRepo,
        },
      ],
    }).compile();
    service = moduleRef.get(EvidencePackJobsService);
  });

  describe('create', () => {
    it('enqueues an evidence pack job and returns a DTO', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      dispatch.enqueue.mockResolvedValue({
        id: 'job-1',
        status: EvidencePackJobStatus.QUEUED,
        outputKey: null,
        errorMessage: null,
        manifest: null,
        createdAt,
        completedAt: null,
      });

      const result = await service.create(user, {});

      expect(dispatch.enqueue).toHaveBeenCalledWith('org-1', 'user-1', {});
      expect(result).toEqual({
        jobId: 'job-1',
        status: EvidencePackJobStatus.QUEUED,
        outputKey: null,
        errorMessage: null,
        manifest: null,
        createdAt: createdAt.toISOString(),
        completedAt: null,
      });
    });
  });

  describe('findOne', () => {
    it('returns the job DTO when found', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      findOne.mockResolvedValue({
        id: 'job-1',
        status: EvidencePackJobStatus.COMPLETED,
        outputKey: 'orgs/org-1/export/obj/pack.zip',
        errorMessage: null,
        manifest: { ['curriculum_intent']: 1 } as Record<string, number>,
        createdAt,
        completedAt: new Date('2026-01-02T00:00:00.000Z'),
      });
      storage.createDownloadUrl.mockResolvedValue({
        downloadUrl: 'https://download.example.com/pack.zip',
        expiresAt: new Date('2026-01-03T00:00:00.000Z'),
      });

      const result = await service.findOne(user, 'job-1');

      expect(result.jobId).toBe('job-1');
      expect(result.downloadUrl).toBe('https://download.example.com/pack.zip');
      expect(result.manifest).toEqual({ ['curriculum_intent']: 1 });
    });

    it('throws when job is not found', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.findOne(user, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
