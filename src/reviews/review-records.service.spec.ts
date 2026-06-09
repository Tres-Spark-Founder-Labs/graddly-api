import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ReviewRecord } from './entities/review-record.entity.js';
import { Review } from './entities/review.entity.js';
import { ReviewStatus } from './enums/review-status.enum.js';
import { ReviewRecordsService } from './review-records.service.js';

describe('ReviewRecordsService', () => {
  const recordRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const reviewRepo = { findOne: jest.fn(), save: jest.fn() };

  let service: ReviewRecordsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewRecordsService,
        { provide: getRepositoryToken(ReviewRecord), useValue: recordRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
      ],
    }).compile();

    service = moduleRef.get(ReviewRecordsService);
    jest.clearAllMocks();
  });

  const user = { id: 'u-1', organisationId: 'org-1' } as const;
  const payload = {
    smartGoals: [
      {
        objective: 'Improve',
        measurable: 'Tests',
        achievable: 'Yes',
        relevant: 'Yes',
        timeBound: 'Q2',
      },
    ],
    wellbeing: { score: 7, notes: 'OK' },
  };

  it('upserts record and moves review to in_progress', async () => {
    reviewRepo.findOne.mockResolvedValue({
      id: 'r-1',
      organisationId: 'org-1',
      status: ReviewStatus.SCHEDULED,
    });
    recordRepo.findOne.mockResolvedValue(null);
    recordRepo.create.mockImplementation((v: unknown) => v);
    recordRepo.save.mockImplementation((v: unknown) => Promise.resolve(v));
    reviewRepo.save.mockImplementation((v: unknown) => Promise.resolve(v));

    const result = await service.upsert(user, 'r-1', { payload });
    expect(result.reviewId).toBe('r-1');
    expect(reviewRepo.save).toHaveBeenCalled();
  });

  it('blocks upsert on completed review', async () => {
    reviewRepo.findOne.mockResolvedValue({
      id: 'r-1',
      status: ReviewStatus.COMPLETED,
    });
    await expect(
      service.upsert(user, 'r-1', { payload }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when record missing on get', async () => {
    recordRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne(user, 'r-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns payload for PDF generation', async () => {
    reviewRepo.findOne.mockResolvedValue({
      id: 'r-1',
      organisationId: 'org-1',
      isDeleted: false,
      title: 'Review 1',
      scheduledAt: new Date('2026-06-01T10:00:00Z'),
      apprentice: { firstName: 'Ada', lastName: 'Lovelace' },
    });
    recordRepo.findOne.mockResolvedValue({
      reviewId: 'r-1',
      organisationId: 'org-1',
      payload,
    });

    const result = await service.getPayloadForPdf('org-1', 'r-1');

    expect(result.apprenticeName).toBe('Ada Lovelace');
    expect(result.payload).toEqual(payload);
  });
});
