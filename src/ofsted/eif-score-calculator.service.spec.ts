import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { Review } from '../reviews/entities/review.entity.js';

import { EifScoreCalculatorService } from './eif-score-calculator.service.js';
import { ProgrammeDocumentsService } from './programme-documents.service.js';
import { SafeguardingChecklistService } from './safeguarding-checklist.service.js';

describe('EifScoreCalculatorService', () => {
  const enrolmentRepo = { find: jest.fn() };
  const otjRepo = { findOne: jest.fn() };
  const reviewRepo = { count: jest.fn() };
  const commitmentRepo = { createQueryBuilder: jest.fn() };
  const ilrRepo = { count: jest.fn() };
  const evidenceRepo = { count: jest.fn() };
  const safeguardingChecklist = { completionPercent: jest.fn() };
  const programmeDocuments = { coveragePercent: jest.fn() };

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
    safeguardingChecklist.completionPercent.mockResolvedValue(50);
    programmeDocuments.coveragePercent.mockResolvedValue(33);

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
        {
          provide: SafeguardingChecklistService,
          useValue: safeguardingChecklist,
        },
        {
          provide: ProgrammeDocumentsService,
          useValue: programmeDocuments,
        },
      ],
    }).compile();

    service = moduleRef.get(EifScoreCalculatorService);
  });

  describe('calculate', () => {
    it('returns EIF criteria scores from live services not stub constants', async () => {
      const result = await service.calculate('org-1');

      expect(safeguardingChecklist.completionPercent).toHaveBeenCalledWith(
        'org-1',
      );
      expect(programmeDocuments.coveragePercent).toHaveBeenCalledWith('org-1');

      const safeguarding = result.criteria.find(
        (c) => c.slug === 'safeguarding',
      );
      const curriculum = result.criteria.find(
        (c) => c.slug === 'curriculum_intent',
      );
      expect(safeguarding?.percent).toBe(50);
      expect(curriculum?.percent).toBe(33);
      expect(result.criteria.length).toBeGreaterThan(0);
    });
  });
});
