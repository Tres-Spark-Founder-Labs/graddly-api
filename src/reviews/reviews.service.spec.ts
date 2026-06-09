import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';

import { Review } from './entities/review.entity.js';
import { ReviewStatus } from './enums/review-status.enum.js';
import { REVIEW_BULK_SCHEDULE_MAX } from './reviews.constants.js';
import { ReviewsService } from './reviews.service.js';

describe('ReviewsService', () => {
  const reviewRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const enrolmentRepo = { findOne: jest.fn() };
  const eifScoreCache = { invalidate: jest.fn() };

  let service: ReviewsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: EifScoreCacheService, useValue: eifScoreCache },
      ],
    }).compile();

    service = moduleRef.get(ReviewsService);
    jest.clearAllMocks();
  });

  const user = {
    id: 'u-1',
    organisationId: 'org-1',
  } as const;

  it('creates a scheduled review', async () => {
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'e-1',
      organisationId: 'org-1',
      apprenticeId: 'a-1',
    });
    reviewRepo.create.mockImplementation((v: unknown) => v);
    reviewRepo.save.mockImplementation((v: unknown) =>
      Promise.resolve({
        ...v,
        id: 'r-1',
        scheduledAt: new Date('2026-06-01T10:00:00Z'),
      }),
    );

    const created = await service.create(user, {
      enrolmentId: 'e-1',
      apprenticeId: 'a-1',
      scheduledAt: '2026-06-01T10:00:00.000Z',
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-emp',
    });

    expect(created.status).toBe(ReviewStatus.SCHEDULED);
    expect(created.id).toBe('r-1');
  });

  it('rejects apprentice mismatch on enrolment', async () => {
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'e-1',
      organisationId: 'org-1',
      apprenticeId: 'a-other',
    });
    await expect(
      service.create(user, {
        enrolmentId: 'e-1',
        apprenticeId: 'a-1',
        scheduledAt: '2026-06-01T10:00:00.000Z',
        apprenticeUserId: 'u-app',
        tutorUserId: 'u-tutor',
        employerManagerUserId: 'u-emp',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws not found on missing review', async () => {
    reviewRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne(user, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects bulk schedule over cap', async () => {
    const items = Array.from({ length: REVIEW_BULK_SCHEDULE_MAX + 1 }, () => ({
      enrolmentId: 'e-1',
      apprenticeId: 'a-1',
      scheduledAt: '2026-06-01T10:00:00.000Z',
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-emp',
    }));
    await expect(service.bulkSchedule(user, items)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('clears overdue flag when rescheduled while scheduled', async () => {
    reviewRepo.findOne.mockResolvedValue({
      id: 'r-1',
      organisationId: 'org-1',
      isDeleted: false,
      status: ReviewStatus.SCHEDULED,
      isOverdue: true,
      overdueSince: '2026-05-01',
      scheduledAt: new Date('2026-05-01T10:00:00Z'),
    });
    reviewRepo.save.mockImplementation((v: unknown) => Promise.resolve(v));

    const updated = await service.update(user, 'r-1', {
      scheduledAt: '2026-07-01T10:00:00.000Z',
    });

    expect(updated.isOverdue).toBe(false);
    expect(updated.overdueSince).toBeNull();
  });
});
