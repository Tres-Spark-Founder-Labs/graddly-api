import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EpaOutcomeRecord } from '../enrolments/entities/epa-outcome.entity.js';
import { EpaOutcome } from '../enrolments/enums/epa-outcome.enum.js';

import { EpaOutcomeMetricsService } from './epa-outcome-metrics.service.js';

describe('EpaOutcomeMetricsService (F1.4.1 AC1)', () => {
  const epaOutcomeRepo = { find: jest.fn() };
  let service: EpaOutcomeMetricsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EpaOutcomeMetricsService,
        {
          provide: getRepositoryToken(EpaOutcomeRecord),
          useValue: epaOutcomeRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(EpaOutcomeMetricsService);
    jest.clearAllMocks();
  });

  const row = (outcome: EpaOutcome, assessedOn = '2026-05-01') => ({
    outcome,
    assessedOn,
  });

  /**
   * The distinction that makes or breaks this number: merit and distinction
   * are pass grades. Counting only `PASS` would report a high-performing
   * cohort as failing.
   */
  it('counts merit and distinction as passes', async () => {
    epaOutcomeRepo.find.mockResolvedValue([
      row(EpaOutcome.PASS),
      row(EpaOutcome.MERIT),
      row(EpaOutcome.DISTINCTION),
      row(EpaOutcome.FAIL),
    ]);

    const result = await service.passRateForEnrolments(['e1']);

    expect(result).toEqual({ passRate: 75, assessedCount: 4, passCount: 3 });
  });

  /**
   * Null, not zero. Zero means "everyone failed"; this cohort has not sat the
   * assessment. A board report cannot conflate the two.
   */
  it('returns null when nothing has been assessed', async () => {
    epaOutcomeRepo.find.mockResolvedValue([]);

    await expect(service.passRateForEnrolments(['e1'])).resolves.toEqual({
      passRate: null,
      assessedCount: 0,
      passCount: 0,
    });
  });

  it('returns null for an empty enrolment list without querying', async () => {
    const result = await service.passRateForEnrolments([]);

    expect(result.passRate).toBeNull();
    expect(epaOutcomeRepo.find).not.toHaveBeenCalled();
  });

  /**
   * Scoped by enrolment id, never by organisation: `epa_outcomes` rows carry
   * the organisation of whoever recorded the assessment, which is the
   * training provider, so an employer-scoped filter would find nothing for
   * the employer's own apprentices.
   */
  it('filters by enrolment, not organisation', async () => {
    epaOutcomeRepo.find.mockResolvedValue([]);

    await service.passRateForEnrolments(['e1', 'e2']);

    const where = (
      epaOutcomeRepo.find.mock.calls as [{ where: Record<string, unknown> }][]
    )[0][0].where;
    expect(where).not.toHaveProperty('organisationId');
    expect(where).toHaveProperty('enrolmentId');
  });

  describe('period windowing (AC3)', () => {
    beforeEach(() => {
      epaOutcomeRepo.find.mockResolvedValue([
        row(EpaOutcome.PASS, '2025-06-15'),
        row(EpaOutcome.FAIL, '2026-03-10'),
        row(EpaOutcome.PASS, '2026-05-20'),
      ]);
    });

    it('counts only assessments inside the window', async () => {
      const result = await service.passRateForEnrolments(['e1'], {
        from: new Date('2026-01-01T00:00:00Z'),
        to: new Date('2026-12-31T00:00:00Z'),
      });

      expect(result).toEqual({ passRate: 50, assessedCount: 2, passCount: 1 });
    });

    it('includes assessments on the window boundaries', async () => {
      const result = await service.passRateForEnrolments(['e1'], {
        from: new Date('2026-03-10T00:00:00Z'),
        to: new Date('2026-05-20T00:00:00Z'),
      });

      expect(result.assessedCount).toBe(2);
    });

    /**
     * `assessedOn` is a `date` column with no timezone. Parsing it into a
     * Date would apply the server's offset and could move an assessment
     * across a year boundary for anyone east or west of UTC — silently
     * reassigning it to the wrong reporting period.
     */
    it('compares calendar dates rather than parsing to timestamps', async () => {
      epaOutcomeRepo.find.mockResolvedValue([
        row(EpaOutcome.PASS, '2026-01-01'),
      ]);

      const result = await service.passRateForEnrolments(['e1'], {
        from: new Date('2026-01-01T23:30:00Z'),
      });

      expect(result.assessedCount).toBe(1);
    });

    it('returns null when the window is empty', async () => {
      const result = await service.passRateForEnrolments(['e1'], {
        from: new Date('2020-01-01T00:00:00Z'),
        to: new Date('2020-12-31T00:00:00Z'),
      });

      expect(result.passRate).toBeNull();
    });
  });
});
