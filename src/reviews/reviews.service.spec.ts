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

  it('returns paginated reviews', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 'r-1',
            organisationId: 'org-1',
            enrolmentId: 'e-1',
            apprenticeId: 'a-1',
            scheduledAt: new Date('2026-06-01T10:00:00Z'),
            status: ReviewStatus.SCHEDULED,
            isOverdue: false,
            overdueSince: null,
            title: null,
            reviewType: null,
            apprenticeUserId: 'u-app',
            tutorUserId: 'u-tutor',
            employerManagerUserId: 'u-emp',
          },
        ],
        1,
      ]),
    };
    reviewRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.findAll(user, { page: 1, perPage: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('finds review entity by id', async () => {
    const entity = {
      id: 'r-1',
      organisationId: 'org-1',
      isDeleted: false,
    } as Review;
    reviewRepo.findOne.mockResolvedValue(entity);

    await expect(service.findEntity(user, 'r-1')).resolves.toEqual(entity);
  });

  it('maps review entity to response DTO', () => {
    const response = service.toResponse({
      id: 'r-1',
      organisationId: 'org-1',
      enrolmentId: 'e-1',
      apprenticeId: 'a-1',
      scheduledAt: new Date('2026-06-01T10:00:00Z'),
      status: ReviewStatus.SCHEDULED,
      isOverdue: false,
      overdueSince: null,
      title: 'Progress review',
      reviewType: null,
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-emp',
    } as Review);

    expect(response.id).toBe('r-1');
    expect(response.title).toBe('Progress review');
  });
});
