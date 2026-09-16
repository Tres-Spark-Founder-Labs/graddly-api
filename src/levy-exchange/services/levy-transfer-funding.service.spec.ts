import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  getRlsBootstrap,
  runWithCorrelationId,
} from '../../common/context/correlation-id-context.js';
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
  const enrolmentRepo = { findOne: jest.fn() };
  const transferRepo = { findOne: jest.fn() };

  const DONOR = 'org-donor';
  const RECIPIENT = 'org-recipient';

  const PROVIDER = 'org-provider';

  /** The four columns the link depends on, and nothing else. */
  const transfer = (overrides = {}) =>
    ({
      id: 't-1',
      status: LevyTransferStatus.CONFIRMED,
      donorOrganisationId: DONOR,
      recipientOrganisationId: RECIPIENT,
      ...overrides,
    }) as LevyTransfer;

  const enrolment = (overrides = {}) =>
    ({
      id: 'e-1',
      organisationId: PROVIDER,
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
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(LevyTransfer), useValue: transferRepo },
      ],
    }).compile();

    service = moduleRef.get(LevyTransferFundingService);
    jest.clearAllMocks();

    linkRepo.create.mockImplementation((v: unknown) => v);
    linkRepo.save.mockImplementation((v: unknown) => Promise.resolve(v));
    linkRepo.findOne.mockResolvedValue(null);
  });

  describe('link', () => {
    const asProvider = (overrides = {}) => ({
      transferId: 't-1',
      enrolmentId: 'e-1',
      callerOrganisationId: PROVIDER,
      ...overrides,
    });

    const inRequest = <T>(fn: () => Promise<T>): Promise<T> =>
      runWithCorrelationId({ correlationId: 'funding-spec' }, fn);

    it('records the link and denormalises the donor', async () => {
      enrolmentRepo.findOne.mockResolvedValue(enrolment());
      transferRepo.findOne.mockResolvedValue(transfer());

      const result = await service.link(asProvider());

      expect(result).toMatchObject({
        transferId: 't-1',
        enrolmentId: 'e-1',
        donorOrganisationId: DONOR,
      });
    });

    /**
     * The counterparty case of the bootstrap rule on setRlsBootstrap: the
     * caller is party to the enrolment, not to the transfer, so the four
     * conditions apply here too.
     */
    it('reads the transfer in a bootstrap window, and only the columns the link depends on', async () => {
      const flagDuringRead: boolean[] = [];
      enrolmentRepo.findOne.mockImplementation(() => {
        flagDuringRead.push(getRlsBootstrap());
        return Promise.resolve(enrolment());
      });
      transferRepo.findOne.mockImplementation(() => {
        flagDuringRead.push(getRlsBootstrap());
        return Promise.resolve(transfer());
      });

      await inRequest(async () => {
        await service.link(asProvider());
        // The enrolment is read under RLS; only the transfer needs the window.
        expect(flagDuringRead).toEqual([false, true]);
        expect(getRlsBootstrap()).toBe(false);
      });

      expect(transferRepo.findOne).toHaveBeenCalledWith({
        where: { id: 't-1', isDeleted: false },
        select: [
          'id',
          'status',
          'donorOrganisationId',
          'recipientOrganisationId',
        ],
      });
    });

    /**
     * The fix for this route. It ran with RLS off and never looked at the
     * caller, so any organisation could attach a recipient's learner to a
     * transfer — and this count is published in a donor's ESG report.
     */
    it('refuses a caller that does not own the enrolment, before reading the transfer', async () => {
      enrolmentRepo.findOne.mockResolvedValue(enrolment());

      await expect(
        service.link(asProvider({ callerOrganisationId: DONOR })),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(transferRepo.findOne).not.toHaveBeenCalled();
      expect(linkRepo.save).not.toHaveBeenCalled();
    });

    it('accepts an active transfer as well as a confirmed one', async () => {
      enrolmentRepo.findOne.mockResolvedValue(enrolment());
      transferRepo.findOne.mockResolvedValue(
        transfer({ status: LevyTransferStatus.ACTIVE }),
      );

      await expect(service.link(asProvider())).resolves.toBeDefined();
    });

    it.each([
      LevyTransferStatus.DRAFT,
      LevyTransferStatus.PENDING_SIGNATURES,
      LevyTransferStatus.PENDING_ESFA,
      LevyTransferStatus.FAILED,
    ])(
      'refuses a transfer that is %s — it has not funded anything',
      async (status) => {
        enrolmentRepo.findOne.mockResolvedValue(enrolment());
        transferRepo.findOne.mockResolvedValue(transfer({ status }));

        await expect(service.link(asProvider())).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );

    /**
     * The rule that stops a provider attributing any learner on their books to
     * a donor's transfer.
     */
    it('refuses an enrolment belonging to a different employer', async () => {
      enrolmentRepo.findOne.mockResolvedValue(
        enrolment({ employerOrganisationId: 'org-someone-else' }),
      );
      transferRepo.findOne.mockResolvedValue(transfer());

      await expect(service.link(asProvider())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(linkRepo.save).not.toHaveBeenCalled();
    });

    it('refuses an enrolment with no employer rather than assuming it matches', async () => {
      enrolmentRepo.findOne.mockResolvedValue(
        enrolment({ employerOrganisationId: null }),
      );

      await expect(service.link(asProvider())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(transferRepo.findOne).not.toHaveBeenCalled();
    });

    it('is idempotent — relinking returns the existing row, it does not duplicate', async () => {
      enrolmentRepo.findOne.mockResolvedValue(enrolment());
      transferRepo.findOne.mockResolvedValue(transfer());
      const already = { id: 'link-1', transferId: 't-1', enrolmentId: 'e-1' };
      linkRepo.findOne.mockResolvedValue(already);

      const result = await service.link(asProvider());

      expect(result).toBe(already);
      expect(linkRepo.save).not.toHaveBeenCalled();
    });

    it('throws when the transfer does not exist', async () => {
      enrolmentRepo.findOne.mockResolvedValue(enrolment());
      transferRepo.findOne.mockResolvedValue(null);

      await expect(
        service.link(asProvider({ transferId: 'nope' })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the enrolment does not exist', async () => {
      enrolmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.link(asProvider({ enrolmentId: 'nope' })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unlink', () => {
    const existing = () => ({
      id: 'link-1',
      transferId: 't-1',
      enrolmentId: 'e-1',
      isDeleted: false,
    });

    it('soft-deletes the link and confirms it by reading back', async () => {
      linkRepo.findOne
        .mockResolvedValueOnce(existing())
        .mockResolvedValueOnce({ id: 'link-1', isDeleted: true });

      await service.unlink('t-1', 'e-1');

      expect(linkRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'link-1', isDeleted: true }),
      );
    });

    /**
     * levy_transfer_enrolments_select shows the link to the donor and the
     * recipient; levy_transfer_enrolments_update admits only the enrolment's
     * owner. Under RLS the refused UPDATE affects no rows and save() does not
     * say so, so the read-back is the only thing between a donor and a
     * success message over an untouched row.
     */
    it('refuses rather than reporting success when the update affected no rows', async () => {
      linkRepo.findOne
        .mockResolvedValueOnce(existing())
        .mockResolvedValueOnce({ id: 'link-1', isDeleted: false });

      await expect(service.unlink('t-1', 'e-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws when the link does not exist', async () => {
      linkRepo.findOne.mockResolvedValue(null);

      await expect(service.unlink('t-1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
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
