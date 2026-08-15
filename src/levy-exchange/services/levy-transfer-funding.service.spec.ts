import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { LevyTransferEnrolment } from '../entities/levy-transfer-enrolment.entity.js';
import { LevyTransfer } from '../entities/levy-transfer.entity.js';
import { LevyTransferStatus } from '../enums/levy-transfer-status.enum.js';

import { LevyTransferFundingService } from './levy-transfer-funding.service.js';

/**
 * F4.1.4 AC1.
 *
 * Every rule here exists because the resulting count is *published* — AC4
 * exports it for a donor's annual ESG report. These tests are about the ways
 * that number could be wrong, not about the happy path.
 */
describe('LevyTransferFundingService', () => {
  let service: LevyTransferFundingService;

  const linkRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const transferRepo = { findOne: jest.fn() };
  const enrolmentRepo = { findOne: jest.fn() };

  const DONOR = 'org-donor';
  const RECIPIENT = 'org-recipient';

  const transfer = (overrides = {}) =>
    ({
      id: 't-1',
      donorOrganisationId: DONOR,
      recipientOrganisationId: RECIPIENT,
      status: LevyTransferStatus.CONFIRMED,
      isDeleted: false,
      ...overrides,
    }) as LevyTransfer;

  const enrolment = (overrides = {}) =>
    ({
      id: 'e-1',
      employerOrganisationId: RECIPIENT,
      isDeleted: false,
      ...overrides,
    }) as Enrolment;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyTransferFundingService,
        {
          provide: getRepositoryToken(LevyTransferEnrolment),
          useValue: linkRepo,
        },
        { provide: getRepositoryToken(LevyTransfer), useValue: transferRepo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
      ],
    }).compile();

    service = moduleRef.get(LevyTransferFundingService);
    jest.clearAllMocks();

    linkRepo.create.mockImplementation((v: unknown) => v);
    linkRepo.save.mockImplementation((v: unknown) => Promise.resolve(v));
    linkRepo.findOne.mockResolvedValue(null);
  });

  describe('link', () => {
    it('records the link and denormalises the donor', async () => {
      transferRepo.findOne.mockResolvedValue(transfer());
      enrolmentRepo.findOne.mockResolvedValue(enrolment());

      const result = await service.link({
        transferId: 't-1',
        enrolmentId: 'e-1',
      });

      expect(result).toMatchObject({
        transferId: 't-1',
        enrolmentId: 'e-1',
        donorOrganisationId: DONOR,
      });
    });

    it('accepts an active transfer as well as a confirmed one', async () => {
      transferRepo.findOne.mockResolvedValue(
        transfer({ status: LevyTransferStatus.ACTIVE }),
      );
      enrolmentRepo.findOne.mockResolvedValue(enrolment());

      await expect(
        service.link({ transferId: 't-1', enrolmentId: 'e-1' }),
      ).resolves.toBeDefined();
    });

    it.each([
      LevyTransferStatus.DRAFT,
      LevyTransferStatus.PENDING_SIGNATURES,
      LevyTransferStatus.PENDING_ESFA,
      LevyTransferStatus.FAILED,
    ])(
      'refuses a transfer that is %s — it has not funded anything',
      async (status) => {
        transferRepo.findOne.mockResolvedValue(transfer({ status }));
        enrolmentRepo.findOne.mockResolvedValue(enrolment());

        await expect(
          service.link({ transferId: 't-1', enrolmentId: 'e-1' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    /**
     * The rule that stops a provider attributing any learner on their books to
     * a donor's transfer.
     */
    it('refuses an enrolment belonging to a different employer', async () => {
      transferRepo.findOne.mockResolvedValue(transfer());
      enrolmentRepo.findOne.mockResolvedValue(
        enrolment({ employerOrganisationId: 'org-someone-else' }),
      );

      await expect(
        service.link({ transferId: 't-1', enrolmentId: 'e-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an enrolment with no employer rather than assuming it matches', async () => {
      transferRepo.findOne.mockResolvedValue(transfer());
      enrolmentRepo.findOne.mockResolvedValue(
        enrolment({ employerOrganisationId: null }),
      );

      await expect(
        service.link({ transferId: 't-1', enrolmentId: 'e-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is idempotent — relinking returns the existing row, it does not duplicate', async () => {
      transferRepo.findOne.mockResolvedValue(transfer());
      enrolmentRepo.findOne.mockResolvedValue(enrolment());
      const already = { id: 'link-1', transferId: 't-1', enrolmentId: 'e-1' };
      linkRepo.findOne.mockResolvedValue(already);

      const result = await service.link({
        transferId: 't-1',
        enrolmentId: 'e-1',
      });

      expect(result).toBe(already);
      expect(linkRepo.save).not.toHaveBeenCalled();
    });

    it('throws when the transfer does not exist', async () => {
      transferRepo.findOne.mockResolvedValue(null);
      await expect(
        service.link({ transferId: 'nope', enrolmentId: 'e-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the enrolment does not exist', async () => {
      transferRepo.findOne.mockResolvedValue(transfer());
      enrolmentRepo.findOne.mockResolvedValue(null);
      await expect(
        service.link({ transferId: 't-1', enrolmentId: 'nope' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('countForDonor', () => {
    it('counts distinct enrolments, so one learner funded twice is one learner', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest
          .fn()
          .mockResolvedValue({ learners: '7', transfers: '3' }),
      };
      linkRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.countForDonor(DONOR);

      expect(result).toEqual({ learnersFunded: 7, transfersWithLearners: 3 });
      // The DISTINCT is the whole point — without it a learner funded by two
      // of the same donor's transfers is counted twice in a published report.
      expect(qb.select).toHaveBeenCalledWith(
        'COUNT(DISTINCT link.enrolmentId)',
        'learners',
      );
    });

    it('reports zero rather than NaN when a donor has funded nothing', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(undefined),
      };
      linkRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.countForDonor(DONOR)).resolves.toEqual({
        learnersFunded: 0,
        transfersWithLearners: 0,
      });
    });
  });
});
