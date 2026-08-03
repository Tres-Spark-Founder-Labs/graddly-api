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
  /**
   * F2.2.3 AC6 — the read path authorises through a join on the enrolment, so
   * the provider that owns the review and the employer on the learner both
   * resolve. `getOne` is what that path returns.
   */
  const readerQb = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const reviewRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(() => readerQb),
  };

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
    readerQb.getOne.mockResolvedValue({ id: 'r-1', organisationId: 'org-1' });
    recordRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne(user, 'r-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  /**
   * F2.2.3 AC6. The employer is notified when a review completes, so a record
   * they cannot open means being told about a document that 404s. The
   * authorisation join is what makes it readable — this pins that `findOne`
   * goes through it rather than matching on the owning organisation.
   */
  it('reads a record the caller does not own but is linked to', async () => {
    readerQb.getOne.mockResolvedValue({ id: 'r-1', organisationId: 'org-1' });
    recordRepo.findOne.mockResolvedValue({
      reviewId: 'r-1',
      // Owned by the provider, requested by the employer.
      organisationId: 'provider-org',
      payload,
      submittedAt: new Date(),
      submittedByUserId: 'u-9',
    });

    const result = await service.findOne(
      { id: 'u-2', organisationId: 'employer-org' } as never,
      'r-1',
    );

    expect(result.reviewId).toBe('r-1');
    expect(reviewRepo.createQueryBuilder).toHaveBeenCalled();
    // Scoped by review, not by owning organisation — an employer filtering on
    // their own org id would match nothing.
    expect(recordRepo.findOne).toHaveBeenCalledWith({
      where: { reviewId: 'r-1' },
    });
  });

  it('refuses a record the caller is not linked to', async () => {
    readerQb.getOne.mockResolvedValue(null);

    await expect(
      service.findOne(
        { id: 'u-3', organisationId: 'other-org' } as never,
        'r-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
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

  /**
   * F2.2.3 AC4 — "progress against previous goals". The point of a
   * twelve-weekly cycle is that each review answers for the one before it, so
   * the tutor is handed last time's goals rather than retyping them.
   */
  describe('previousGoals (AC4)', () => {
    it('returns the goals from the last completed review', async () => {
      reviewRepo.findOne
        .mockResolvedValueOnce({
          id: 'r-2',
          enrolmentId: 'e-1',
          scheduledAt: new Date('2026-09-01T10:00:00Z'),
        })
        .mockResolvedValueOnce({
          id: 'r-1',
          scheduledAt: new Date('2026-06-01T10:00:00Z'),
        });
      recordRepo.findOne.mockResolvedValue({
        reviewId: 'r-1',
        payload: {
          smartGoals: [
            { objective: 'Complete unit 3' },
            { objective: 'Shadow a senior engineer' },
          ],
        },
      });

      const goals = await service.previousGoals(user, 'r-2');

      expect(goals).toEqual([
        { objective: 'Complete unit 3' },
        { objective: 'Shadow a senior engineer' },
      ]);
    });

    /** A learner's first review has nothing to look back on. */
    it('returns an empty list when there is no earlier review', async () => {
      reviewRepo.findOne
        .mockResolvedValueOnce({
          id: 'r-1',
          enrolmentId: 'e-1',
          scheduledAt: new Date('2026-06-01T10:00:00Z'),
        })
        .mockResolvedValueOnce(null);

      await expect(service.previousGoals(user, 'r-1')).resolves.toEqual([]);
    });

    it('tolerates a previous review whose record has no goals', async () => {
      reviewRepo.findOne
        .mockResolvedValueOnce({
          id: 'r-2',
          enrolmentId: 'e-1',
          scheduledAt: new Date('2026-09-01T10:00:00Z'),
        })
        .mockResolvedValueOnce({ id: 'r-1' });
      recordRepo.findOne.mockResolvedValue({ reviewId: 'r-1', payload: {} });

      await expect(service.previousGoals(user, 'r-2')).resolves.toEqual([]);
    });

    /** A blank objective is not a goal; offering it would be noise. */
    it('drops empty objectives', async () => {
      reviewRepo.findOne
        .mockResolvedValueOnce({
          id: 'r-2',
          enrolmentId: 'e-1',
          scheduledAt: new Date('2026-09-01T10:00:00Z'),
        })
        .mockResolvedValueOnce({ id: 'r-1' });
      recordRepo.findOne.mockResolvedValue({
        reviewId: 'r-1',
        payload: {
          smartGoals: [{ objective: '  ' }, { objective: 'Real goal' }],
        },
      });

      await expect(service.previousGoals(user, 'r-2')).resolves.toEqual([
        { objective: 'Real goal' },
      ]);
    });
  });
});
