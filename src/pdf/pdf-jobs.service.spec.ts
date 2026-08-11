import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { staffLearnerScopeProvider } from '../../test/mocks/learner-scope.mock.js';
import { StorageService } from '../storage/storage.service.js';

import { PdfGenerationJob } from './entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from './enums/pdf-job-status.enum.js';
import { PdfJobTemplate } from './enums/pdf-job-template.enum.js';
import { PdfDispatchService } from './pdf-dispatch.service.js';
import { PdfJobsService } from './pdf-jobs.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

const user = {
  id: 'user-1',
  organisationId: 'org-1',
} as AuthenticatedUser;

describe('PdfJobsService', () => {
  const dispatch = { enqueue: jest.fn() };
  const storage = { createDownloadUrl: jest.fn() };
  const findOne = jest.fn();
  const jobRepo = { findOne };

  let service: PdfJobsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        staffLearnerScopeProvider(),
        PdfJobsService,
        { provide: PdfDispatchService, useValue: dispatch },
        { provide: StorageService, useValue: storage },
        {
          provide: getRepositoryToken(PdfGenerationJob),
          useValue: jobRepo,
        },
      ],
    }).compile();
    service = moduleRef.get(PdfJobsService);
  });

  describe('create', () => {
    it('enqueues a PDF job and returns a DTO', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      dispatch.enqueue.mockResolvedValue({
        id: 'job-1',
        status: PdfJobStatus.QUEUED,
        template: PdfJobTemplate.HELLO,
        outputKey: null,
        errorMessage: null,
        createdAt,
        completedAt: null,
      });

      const result = await service.create(user, {
        template: PdfJobTemplate.HELLO,
      });

      expect(dispatch.enqueue).toHaveBeenCalledWith({
        organisationId: 'org-1',
        userId: 'user-1',
        template: PdfJobTemplate.HELLO,
      });
      expect(result).toEqual({
        jobId: 'job-1',
        status: PdfJobStatus.QUEUED,
        template: PdfJobTemplate.HELLO,
        outputKey: null,
        errorMessage: null,
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
        status: PdfJobStatus.COMPLETED,
        template: PdfJobTemplate.HELLO,
        outputKey: 'orgs/org-1/export/obj/file.pdf',
        errorMessage: null,
        createdAt,
        completedAt: new Date('2026-01-02T00:00:00.000Z'),
      });
      storage.createDownloadUrl.mockResolvedValue({
        downloadUrl: 'https://download.example.com/file.pdf',
        expiresAt: new Date('2026-01-03T00:00:00.000Z'),
      });

      const result = await service.findOne(user, 'job-1');

      expect(result.jobId).toBe('job-1');
      expect(result.downloadUrl).toBe('https://download.example.com/file.pdf');
    });

    it('throws when job is not found', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.findOne(user, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
