import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { Programme } from '../programmes/entities/programme.entity.js';
import { Review } from '../reviews/entities/review.entity.js';

import { EifScoreCalculatorService } from './eif-score-calculator.service.js';

describe('EifScoreCalculatorService', () => {
  const enrolmentRepo = { find: jest.fn() };
  const otjRepo = { findOne: jest.fn() };
  const reviewRepo = { count: jest.fn() };
  const commitmentRepo = { createQueryBuilder: jest.fn() };
  const ilrRepo = { count: jest.fn() };
  const evidenceRepo = { count: jest.fn() };
  const programmeRepo = { count: jest.fn() };

  let service: EifScoreCalculatorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    enrolmentRepo.find.mockResolvedValue([{ id: 'enr-1' }]);
    otjRepo.findOne.mockResolvedValue({ paceFlag: 'on_track' });
    reviewRepo.count.mockResolvedValueOnce(10).mockResolvedValueOnce(8);
    commitmentRepo.createQueryBuilder.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: 'stmt-1' }),
    });
    ilrRepo.count.mockResolvedValueOnce(5).mockResolvedValueOnce(4);
    evidenceRepo.count.mockResolvedValue(1);
    programmeRepo.count.mockResolvedValue(2);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EifScoreCalculatorService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: commitmentRepo,
        },
        { provide: getRepositoryToken(IlrLearnerRecord), useValue: ilrRepo },
        { provide: getRepositoryToken(KsEvidenceItem), useValue: evidenceRepo },
        { provide: getRepositoryToken(Programme), useValue: programmeRepo },
      ],
    }).compile();

    service = moduleRef.get(EifScoreCalculatorService);
  });

  describe('calculate', () => {
    it('returns EIF criteria scores for an organisation', async () => {
      const result = await service.calculate('org-1');

      expect(result.overallPercent).toEqual(expect.any(Number));
      expect(result.alertBanner).toEqual(expect.any(Boolean));
      expect(result.criteria.length).toBeGreaterThan(0);
      expect(result.calculatedAt).toEqual(expect.any(String));
      expect(result.criteria[0]?.slug).toEqual(expect.any(String));
      expect(result.criteria[0]?.label).toEqual(expect.any(String));
      expect(result.criteria[0]?.percent).toEqual(expect.any(Number));
      expect(result.criteria[0]?.rag).toEqual(expect.any(String));
    });

    it('returns zero overall when there are no active enrolments', async () => {
      enrolmentRepo.find.mockResolvedValue([]);
      reviewRepo.count.mockReset().mockResolvedValue(0);
      ilrRepo.count.mockReset().mockResolvedValue(0);
      programmeRepo.count.mockResolvedValue(0);

      const result = await service.calculate('org-empty');

      expect(result.overallPercent).toBeGreaterThanOrEqual(0);
      expect(result.criteria.length).toBeGreaterThan(0);
    });
  });
});
