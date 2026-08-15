import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { LevyRecipientProfile } from '../levy-exchange/entities/levy-recipient-profile.entity.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { LevyTransferFundingService } from '../levy-exchange/services/levy-transfer-funding.service.js';

import { DonorAnalyticsService } from './donor-analytics.service.js';
import { EpaOutcomeMetricsService } from './epa-outcome-metrics.service.js';

/**
 * F4.1.4.
 *
 * These figures are exported into a donor's annual ESG report (AC4), so the
 * tests are about the ways a published number could mislead: a rate that reads
 * as failure when nothing has happened yet, a count inflated by double
 * attribution, a breakdown whose parts do not sum to the whole.
 */
describe('DonorAnalyticsService', () => {
  let service: DonorAnalyticsService;

  const transferRepo = { find: jest.fn() };
  const enrolmentRepo = { find: jest.fn() };
  const recipientProfileRepo = { find: jest.fn() };
  const fundingService = {
    countForDonor: jest.fn(),
    fundedEnrolmentIds: jest.fn(),
  };
  const epaMetrics = { passRateForEnrolments: jest.fn() };

  const DONOR = 'org-donor';

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DonorAnalyticsService,
        { provide: getRepositoryToken(LevyTransfer), useValue: transferRepo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(LevyRecipientProfile),
          useValue: recipientProfileRepo,
        },
        { provide: LevyTransferFundingService, useValue: fundingService },
        { provide: EpaOutcomeMetricsService, useValue: epaMetrics },
      ],
    }).compile();

    service = moduleRef.get(DonorAnalyticsService);
    jest.clearAllMocks();

    transferRepo.find.mockResolvedValue([]);
    enrolmentRepo.find.mockResolvedValue([]);
    recipientProfileRepo.find.mockResolvedValue([]);
    fundingService.countForDonor.mockResolvedValue({
      learnersFunded: 0,
      transfersWithLearners: 0,
    });
    fundingService.fundedEnrolmentIds.mockResolvedValue([]);
    epaMetrics.passRateForEnrolments.mockResolvedValue({
      passRate: null,
      assessedCount: 0,
      passCount: 0,
    });
  });

  describe('getSummary', () => {
    it('AC1 — sums transferred amount and counts distinct SMEs', async () => {
      transferRepo.find.mockResolvedValue([
        { amount: '21000.00', recipientOrganisationId: 'sme-a' },
        { amount: '27000.00', recipientOrganisationId: 'sme-b' },
        // Same SME twice — two transfers, one SME funded.
        { amount: '12000.00', recipientOrganisationId: 'sme-a' },
      ]);

      const result = await service.getSummary(DONOR);

      expect(result.totalTransferred).toBe(60000);
      expect(result.smesFunded).toBe(2);
    });

    it('AC1 — learners funded comes from the distinct-counting link service', async () => {
      fundingService.countForDonor.mockResolvedValue({
        learnersFunded: 5,
        transfersWithLearners: 2,
      });

      const result = await service.getSummary(DONOR);

      expect(result.learnersFunded).toBe(5);
      expect(fundingService.countForDonor).toHaveBeenCalledWith(DONOR);
    });

    it('AC1 — completion rate covers only the enrolments this donor funded', async () => {
      fundingService.fundedEnrolmentIds.mockResolvedValue(['e1', 'e2', 'e3']);
      enrolmentRepo.find.mockResolvedValue([
        { id: 'e1', status: EnrolmentStatus.COMPLETED },
        { id: 'e2', status: EnrolmentStatus.ACTIVE },
        { id: 'e3', status: EnrolmentStatus.ACTIVE },
      ]);

      const result = await service.getSummary(DONOR);

      expect(result.completedCount).toBe(1);
      expect(result.completionRate).toBeCloseTo(33.33, 1);
    });

    /**
     * The distinction that matters most in a published report: nothing funded
     * yet is not the same as everyone failing.
     */
    it('reports a null completion rate when nothing is funded, not 0%', async () => {
      fundingService.fundedEnrolmentIds.mockResolvedValue([]);

      const result = await service.getSummary(DONOR);

      expect(result.completionRate).toBeNull();
      expect(result.completionRate).not.toBe(0);
    });

    it('delegates the EPA pass rate rather than recomputing it', async () => {
      fundingService.fundedEnrolmentIds.mockResolvedValue(['e1', 'e2']);
      epaMetrics.passRateForEnrolments.mockResolvedValue({
        passRate: 100,
        assessedCount: 2,
        passCount: 2,
      });

      const result = await service.getSummary(DONOR);

      // Reused on purpose: that service already encodes merit and distinction
      // as passes, which a reimplementation would very likely get wrong.
      expect(epaMetrics.passRateForEnrolments).toHaveBeenCalledWith([
        'e1',
        'e2',
      ]);
      expect(result.epaPassRate).toBe(100);
      expect(result.epaAssessedCount).toBe(2);
    });

    it('AC3 — esgImpact is explicitly null, never a fabricated score', async () => {
      const result = await service.getSummary(DONOR);
      expect(result.esgImpact).toBeNull();
    });
  });

  describe('getBreakdown', () => {
    it('AC2 — groups by sector and region from the recipient profile', async () => {
      transferRepo.find.mockResolvedValue([
        {
          amount: '21000.00',
          recipientOrganisationId: 'sme-a',
          programmeDetails: { title: 'Engineering Technician L3' },
        },
        {
          amount: '9000.00',
          recipientOrganisationId: 'sme-b',
          programmeDetails: { title: 'Software Developer L4' },
        },
      ]);
      recipientProfileRepo.find.mockResolvedValue([
        { organisationId: 'sme-a', sector: 'Engineering', region: 'Leeds' },
        { organisationId: 'sme-b', sector: 'Digital', region: 'Leeds' },
      ]);

      const result = await service.getBreakdown(DONOR);

      expect(result.bySector).toEqual([
        { label: 'Engineering', amount: 21000 },
        { label: 'Digital', amount: 9000 },
      ]);
      // Both SMEs in one region — amounts combine rather than duplicating.
      expect(result.byRegion).toEqual([{ label: 'Leeds', amount: 30000 }]);
      expect(result.byProgrammeType[0].label).toBe('Engineering Technician L3');
    });

    /**
     * The parts must sum to the whole. Dropping unclassifiable transfers would
     * make a breakdown that silently disagrees with the headline total.
     */
    it('groups transfers with no profile or programme as "Unspecified"', async () => {
      transferRepo.find.mockResolvedValue([
        {
          amount: '5000.00',
          recipientOrganisationId: 'sme-unknown',
          programmeDetails: null,
        },
      ]);
      recipientProfileRepo.find.mockResolvedValue([]);

      const result = await service.getBreakdown(DONOR);

      expect(result.bySector).toEqual([{ label: 'Unspecified', amount: 5000 }]);
      expect(result.byProgrammeType).toEqual([
        { label: 'Unspecified', amount: 5000 },
      ]);
    });

    it('ignores non-string programme detail rather than stringifying an object', async () => {
      transferRepo.find.mockResolvedValue([
        {
          amount: '1000.00',
          recipientOrganisationId: 'sme-a',
          // A nested object rendered into a chart label is worse than nothing.
          programmeDetails: { title: { nested: true }, standard: 'ST0145' },
        },
      ]);
      recipientProfileRepo.find.mockResolvedValue([]);

      const result = await service.getBreakdown(DONOR);

      expect(result.byProgrammeType).toEqual([
        { label: 'ST0145', amount: 1000 },
      ]);
    });

    it('sorts each breakdown by amount, largest first', async () => {
      transferRepo.find.mockResolvedValue([
        {
          amount: '1000.00',
          recipientOrganisationId: 'a',
          programmeDetails: null,
        },
        {
          amount: '9000.00',
          recipientOrganisationId: 'b',
          programmeDetails: null,
        },
      ]);
      recipientProfileRepo.find.mockResolvedValue([
        { organisationId: 'a', sector: 'Small', region: 'X' },
        { organisationId: 'b', sector: 'Large', region: 'Y' },
      ]);

      const result = await service.getBreakdown(DONOR);

      expect(result.bySector.map((r) => r.label)).toEqual(['Large', 'Small']);
    });
  });
});
