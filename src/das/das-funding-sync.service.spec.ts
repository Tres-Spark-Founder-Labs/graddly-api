import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

import { DAS_CLIENT } from './das-client.constants.js';
import { DasFundingSyncService } from './das-funding-sync.service.js';
import { DasFundingPayment } from './entities/das-funding-payment.entity.js';

describe('DasFundingSyncService', () => {
  let service: DasFundingSyncService;

  const fetchFundingPayments = jest.fn();
  const orgFindOne = jest.fn();
  const paymentFindOne = jest.fn();
  const paymentCreate = jest.fn();
  const paymentSave = jest.fn();
  const paymentFind = jest.fn();
  const enrolmentGetOne = jest.fn();

  const enrolmentQb = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: enrolmentGetOne,
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasFundingSyncService,
        { provide: DAS_CLIENT, useValue: { fetchFundingPayments } },
        {
          provide: getRepositoryToken(DasFundingPayment),
          useValue: {
            findOne: paymentFindOne,
            create: paymentCreate,
            save: paymentSave,
            find: paymentFind,
            createQueryBuilder: jest.fn(() => ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getManyAndCount: jest
                .fn()
                .mockResolvedValue([[{ id: 'pay-1' }], 1]),
            })),
          },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findOne: orgFindOne },
        },
        {
          provide: getRepositoryToken(Enrolment),
          useValue: {
            createQueryBuilder: jest.fn(() => enrolmentQb),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(DasFundingSyncService);
    jest.clearAllMocks();
    paymentCreate.mockImplementation((value: DasFundingPayment) => value);
    paymentSave.mockImplementation((value: DasFundingPayment) =>
      Promise.resolve(value),
    );
  });

  it('syncs funding payments for organisation with UKPRN', async () => {
    orgFindOne.mockResolvedValue({ id: 'org-1', ukprn: '12345678' });
    fetchFundingPayments.mockResolvedValue([
      {
        externalReference: 'fp-1',
        paymentDate: '2026-01-15',
        amount: '1500.00',
        currency: 'GBP',
        fundingPeriod: '2025-26',
        clawbackNotice: null,
        learnerRef: null,
        raw: {},
      },
    ]);
    paymentFindOne.mockResolvedValue(null);

    const count = await service.syncOrganisation('org-1', 'user-1');

    expect(count).toBe(1);
    expect(fetchFundingPayments).toHaveBeenCalledWith('12345678');
    expect(paymentSave).toHaveBeenCalled();
  });

  it('throws when organisation has no UKPRN', async () => {
    orgFindOne.mockResolvedValue({ id: 'org-1', ukprn: null });
    await expect(service.syncOrganisation('org-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when organisation is missing', async () => {
    orgFindOne.mockResolvedValue(null);
    await expect(service.syncOrganisation('org-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('derives funding claim status from summary', () => {
    expect(
      service.deriveFundingClaimStatus({
        totalReceived: 0,
        lastPaymentDate: null,
        pendingClawbackCount: 0,
        currency: 'GBP',
      }),
    ).toBe('no_payments');

    expect(
      service.deriveFundingClaimStatus({
        totalReceived: 1000,
        lastPaymentDate: '2026-01-01',
        pendingClawbackCount: 1,
        currency: 'GBP',
      }),
    ).toBe('clawback_pending');

    expect(
      service.deriveFundingClaimStatus({
        totalReceived: 1000,
        lastPaymentDate: '2026-01-01',
        pendingClawbackCount: 0,
        currency: 'GBP',
      }),
    ).toBe('synced');
  });
});
