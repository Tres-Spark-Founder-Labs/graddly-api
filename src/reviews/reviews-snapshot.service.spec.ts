import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';
import { PdfJobTemplate } from '../pdf/enums/pdf-job-template.enum.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { PdfJobsService } from '../pdf/pdf-jobs.service.js';

import { Review } from './entities/review.entity.js';
import { ReviewStatus } from './enums/review-status.enum.js';
import { ReviewsSnapshotService } from './reviews-snapshot.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

const user = {
  id: 'user-1',
  organisationId: 'org-1',
} as AuthenticatedUser;

describe('ReviewsSnapshotService', () => {
  const findOne = jest.fn();
  const save = jest.fn();
  const reviewRepo = { findOne, save };
  const pdfDispatch = { enqueue: jest.fn() };
  const pdfJobsService = { findOne: jest.fn() };

  let service: ReviewsSnapshotService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsSnapshotService,
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: PdfDispatchService, useValue: pdfDispatch },
        { provide: PdfJobsService, useValue: pdfJobsService },
      ],
    }).compile();
    service = moduleRef.get(ReviewsSnapshotService);
  });

  describe('requestSnapshot', () => {
    it('throws when review is not found', async () => {
      findOne.mockResolvedValue(null);

      await expect(
        service.requestSnapshot(user, 'rev-missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws for terminal reviews', async () => {
      findOne.mockResolvedValue({
        id: 'rev-1',
        status: ReviewStatus.COMPLETED,
        snapshotPdfJobId: null,
      });

      await expect(service.requestSnapshot(user, 'rev-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('returns existing snapshot job when already linked', async () => {
      findOne.mockResolvedValue({
        id: 'rev-1',
        status: ReviewStatus.IN_PROGRESS,
        snapshotPdfJobId: 'job-existing',
      });
      pdfJobsService.findOne.mockResolvedValue({
        jobId: 'job-existing',
        status: PdfJobStatus.COMPLETED,
      });

      const result = await service.requestSnapshot(user, 'rev-1');

      expect(pdfJobsService.findOne).toHaveBeenCalledWith(user, 'job-existing');
      expect(pdfDispatch.enqueue).not.toHaveBeenCalled();
      expect(result.jobId).toBe('job-existing');
    });

    it('enqueues a new snapshot job and links it to the review', async () => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const review = {
        id: 'rev-1',
        status: ReviewStatus.SCHEDULED,
        snapshotPdfJobId: null,
      };
      findOne.mockResolvedValue(review);
      pdfDispatch.enqueue.mockResolvedValue({
        id: 'job-new',
        status: PdfJobStatus.QUEUED,
        template: PdfJobTemplate.REVIEW_SNAPSHOT,
        outputKey: null,
        errorMessage: null,
        createdAt,
        completedAt: null,
      });
      save.mockResolvedValue(review);

      const result = await service.requestSnapshot(user, 'rev-1');

      expect(pdfDispatch.enqueue).toHaveBeenCalledWith({
        organisationId: 'org-1',
        userId: 'user-1',
        template: PdfJobTemplate.REVIEW_SNAPSHOT,
        reviewId: 'rev-1',
      });
      expect(review.snapshotPdfJobId).toBe('job-new');
      expect(save).toHaveBeenCalledWith(review);
      expect(result.jobId).toBe('job-new');
    });
  });
});
