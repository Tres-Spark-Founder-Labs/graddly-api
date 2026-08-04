import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasFundingPayment } from '../das/entities/das-funding-payment.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';

import { FundingClaimResolution } from './entities/funding-claim-resolution.entity.js';
import {
  FundingClaimDiscrepancy,
  FundingClaimResolutionStatus,
} from './enums/funding-claim-discrepancy.enum.js';
import { FundingClaimTrackerService } from './funding-claim-tracker.service.js';

describe('FundingClaimTrackerService', () => {
  const enrolmentRepo = { findAndCount: jest.fn(), findOne: jest.fn() };
  const paymentRepo = { find: jest.fn() };
  const resolutionRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  };

  let service: FundingClaimTrackerService;

  const enrolment = (over: Partial<Enrolment> = {}) =>
    ({
      id: 'enr-1',
      organisationId: 'org-1',
      agreedPrice: '15000.00',
      status: EnrolmentStatus.ACTIVE,
      apprentice: { firstName: 'Jane', lastName: 'Smith' },
      standard: { title: 'Software Developer' },
      ...over,
    }) as Enrolment;

  const payment = (amount: string, clawbackNotice: string | null = null) =>
    ({
      enrolmentId: 'enr-1',
      amount,
      clawbackNotice,
    }) as DasFundingPayment;

  beforeEach(async () => {
    jest.clearAllMocks();
    resolutionRepo.find.mockResolvedValue([]);
    paymentRepo.find.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        FundingClaimTrackerService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(DasFundingPayment),
          useValue: paymentRepo,
        },
        {
          provide: getRepositoryToken(FundingClaimResolution),
          useValue: resolutionRepo,
        },
      ],
    }).compile();

    service = moduleRef.get(FundingClaimTrackerService);
  });

  const listOne = async (
    e: Enrolment,
    payments: DasFundingPayment[] = [],
    resolutions: FundingClaimResolution[] = [],
  ) => {
    enrolmentRepo.findAndCount.mockResolvedValue([[e], 1]);
    paymentRepo.find.mockResolvedValue(payments);
    resolutionRepo.find.mockResolvedValue(resolutions);
    const result = await service.list('org-1', {});
    return result.items[0];
  };

  /**
   * The judgement the whole feature rests on. Funding arrives monthly, so an
   * active learner has received a fraction of the agreed price by design.
   * Flagging that would flag every in-flight learner on the platform.
   */
  it('does not call an in-progress underpayment a discrepancy', async () => {
    const claim = await listOne(enrolment(), [payment('6000.00')]);

    expect(claim.claimedAmount).toBe(15000);
    expect(claim.receivedAmount).toBe(6000);
    expect(claim.varianceAmount).toBe(-9000);
    expect(claim.discrepancy).toBe(FundingClaimDiscrepancy.NONE);
    // Nothing to resolve, so no status is asserted.
    expect(claim.resolutionStatus).toBeNull();
  });

  it('calls the same underpayment a shortfall once the programme completes', async () => {
    const claim = await listOne(
      enrolment({ status: EnrolmentStatus.COMPLETED }),
      [payment('6000.00')],
    );

    expect(claim.discrepancy).toBe(FundingClaimDiscrepancy.SHORTFALL);
    // A discrepancy nobody has engaged with defaults to open.
    expect(claim.resolutionStatus).toBe(FundingClaimResolutionStatus.OPEN);
  });

  it('flags a clawback regardless of the totals', async () => {
    const claim = await listOne(enrolment(), [
      payment('15000.00', 'Withdrawn learner — funds reclaimed'),
    ]);

    expect(claim.discrepancy).toBe(FundingClaimDiscrepancy.CLAWBACK);
    expect(claim.clawbackNotices).toEqual([
      'Withdrawn learner — funds reclaimed',
    ]);
  });

  it('flags an overpayment even while in progress', async () => {
    const claim = await listOne(enrolment(), [payment('16000.00')]);

    expect(claim.discrepancy).toBe(FundingClaimDiscrepancy.OVERPAYMENT);
    expect(claim.varianceAmount).toBe(1000);
  });

  /**
   * Comparing these as floats yields 0.009999999999990905 on a perfectly
   * reconciled claim, which would then be reported as an overpayment.
   */
  it('reconciles exactly, without floating-point drift', async () => {
    const claim = await listOne(
      enrolment({ agreedPrice: '15000.10', status: EnrolmentStatus.COMPLETED }),
      [payment('10000.05'), payment('5000.05')],
    );

    expect(claim.varianceAmount).toBe(0);
    expect(claim.discrepancy).toBe(FundingClaimDiscrepancy.NONE);
  });

  it('reports a stored resolution over the default', async () => {
    const claim = await listOne(
      enrolment({ status: EnrolmentStatus.COMPLETED }),
      [payment('6000.00')],
      [
        {
          enrolmentId: 'enr-1',
          status: FundingClaimResolutionStatus.WRITTEN_OFF,
          note: 'Learner withdrew, ESFA confirmed no further payment',
          closedAt: new Date('2026-05-01T00:00:00.000Z'),
        } as FundingClaimResolution,
      ],
    );

    expect(claim.resolutionStatus).toBe(
      FundingClaimResolutionStatus.WRITTEN_OFF,
    );
    expect(claim.resolvedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  describe('setResolution', () => {
    beforeEach(() => {
      enrolmentRepo.findOne.mockResolvedValue(
        enrolment({ status: EnrolmentStatus.COMPLETED }),
      );
      resolutionRepo.findOne.mockResolvedValue(null);
    });

    /**
     * An ESFA reconciliation asks why a four-thousand-pound gap was closed.
     * "Someone clicked resolved" is not an answer.
     */
    it('refuses to close a claim without a note', async () => {
      await expect(
        service.setResolution('org-1', 'enr-1', 'user-1', {
          status: FundingClaimResolutionStatus.RESOLVED,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.setResolution('org-1', 'enr-1', 'user-1', {
          status: FundingClaimResolutionStatus.WRITTEN_OFF,
          note: '   ',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows moving to investigating without a note', async () => {
      await expect(
        service.setResolution('org-1', 'enr-1', 'user-1', {
          status: FundingClaimResolutionStatus.INVESTIGATING,
        }),
      ).resolves.toMatchObject({
        resolutionStatus: FundingClaimResolutionStatus.INVESTIGATING,
      });
    });

    it('stamps closedAt when closing and clears it when reopening', async () => {
      await service.setResolution('org-1', 'enr-1', 'user-1', {
        status: FundingClaimResolutionStatus.RESOLVED,
        note: 'ESFA paid the balance in period 11',
      });
      expect(resolutionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ closedAt: expect.any(Date) as Date }),
      );

      resolutionRepo.save.mockClear();
      await service.setResolution('org-1', 'enr-1', 'user-1', {
        status: FundingClaimResolutionStatus.OPEN,
      });
      expect(resolutionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ closedAt: null }),
      );
    });

    it('rejects an enrolment outside the organisation', async () => {
      enrolmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.setResolution('org-1', 'enr-x', 'user-1', {
          status: FundingClaimResolutionStatus.INVESTIGATING,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('filters to discrepancies when asked', async () => {
    enrolmentRepo.findAndCount.mockResolvedValue([[enrolment()], 1]);
    paymentRepo.find.mockResolvedValue([payment('6000.00')]);

    const result = await service.list('org-1', { discrepanciesOnly: 'true' });

    // In-progress underpayment is not a discrepancy, so nothing survives.
    expect(result.items).toHaveLength(0);
  });
});
