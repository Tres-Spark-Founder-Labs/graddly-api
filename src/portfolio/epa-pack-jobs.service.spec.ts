import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { StorageService } from '../storage/storage.service.js';

import { EpaPackJob } from './entities/epa-pack-job.entity.js';
import { EpaPackJobStatus } from './enums/epa-pack-job-status.enum.js';
import { EpaPackDispatchService } from './epa-pack-dispatch.service.js';
import { EpaPackJobsService } from './epa-pack-jobs.service.js';
import { PortfolioEnrolmentContext } from './portfolio-enrolment.context.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

const user = {
  id: 'user-1',
  organisationId: 'org-1',
} as AuthenticatedUser;

describe('EpaPackJobsService', () => {
  const dispatch = { enqueue: jest.fn() };
  const storage = { createDownloadUrl: jest.fn() };
  const enrolmentContext = { requireEnrolmentForUser: jest.fn() };
  const findOne = jest.fn();
  const jobRepo = { findOne };

  let service: EpaPackJobsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    enrolmentContext.requireEnrolmentForUser.mockResolvedValue({
      id: 'enrol-1',
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        EpaPackJobsService,
        { provide: EpaPackDispatchService, useValue: dispatch },
        { provide: StorageService, useValue: storage },
        { provide: PortfolioEnrolmentContext, useValue: enrolmentContext },
        {
          provide: getRepositoryToken(EpaPackJob),
          useValue: jobRepo,
        },
      ],
    }).compile();
    service = moduleRef.get(EpaPackJobsService);
  });

  describe('create', () => {
    it('enqueues an EPA pack job and returns a DTO', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      dispatch.enqueue.mockResolvedValue({
        id: 'job-1',
        enrolmentId: 'enrol-1',
        status: EpaPackJobStatus.QUEUED,
        outputKey: null,
        errorMessage: null,
        manifest: null,
        createdAt,
        completedAt: null,
      });

      const result = await service.create(user, { enrolmentId: 'enrol-1' });

      expect(enrolmentContext.requireEnrolmentForUser).toHaveBeenCalledWith(
        user,
        'enrol-1',
      );
      expect(dispatch.enqueue).toHaveBeenCalledWith('org-1', 'user-1', {
        enrolmentId: 'enrol-1',
      });
      expect(result).toEqual({
        jobId: 'job-1',
        enrolmentId: 'enrol-1',
        status: EpaPackJobStatus.QUEUED,
        outputKey: null,
        errorMessage: null,
        manifest: null,
        createdAt: createdAt.toISOString(),
        completedAt: null,
      });
    });
  });

  describe('findOne', () => {
    it('returns the job DTO with download URL when completed', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      findOne.mockResolvedValue({
        id: 'job-1',
        enrolmentId: 'enrol-1',
        status: EpaPackJobStatus.COMPLETED,
        outputKey: 'orgs/org-1/export/obj/pack.zip',
        errorMessage: null,
        manifest: { knowledge: 2 },
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
      expect(result.manifest).toEqual({ knowledge: 2 });
    });

    it('throws when job is not found', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.findOne(user, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
