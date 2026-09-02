import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Organisation } from '../organisations/entities/organisation.entity.js';

import { DasManualClient } from './das-manual.client.js';
import { DasFundingPayment } from './entities/das-funding-payment.entity.js';
import { DasLevyBalance } from './entities/das-levy-balance.entity.js';
import { DasManualDataMissingException } from './exceptions/das-manual-data-missing.exception.js';

/**
 * The manual client's contract is mostly about what it refuses to do.
 *
 * Every test here is a way of asking "does it invent a number when it has
 * none?" — because the failure that matters is not a crash, it is a plausible
 * figure appearing on a levy dashboard with nothing behind it.
 */
describe('DasManualClient', () => {
  const levyRepo = { findOne: jest.fn() };
  const paymentRepo = { find: jest.fn() };
  const organisationRepo = { findOne: jest.fn() };

  let client: DasManualClient;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasManualClient,
        { provide: getRepositoryToken(DasLevyBalance), useValue: levyRepo },
        {
          provide: getRepositoryToken(DasFundingPayment),
          useValue: paymentRepo,
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationRepo,
        },
      ],
    }).compile();
    client = moduleRef.get(DasManualClient);
  });

  describe('fetchLevyBalance', () => {
    it('returns the manually-entered balance', async () => {
      levyRepo.findOne.mockResolvedValue({
        accountId: 'ACC-1',
        balance: '12345.67',
        currency: 'GBP',
        lastSyncedAt: new Date('2026-09-01T10:00:00.000Z'),
        rawPayload: { enteredByUserId: 'user-1' },
      });

      const result = await client.fetchLevyBalance('10001234');

      expect(result.balance).toBe('12345.67');
      expect(result.accountId).toBe('ACC-1');
      expect(result.currency).toBe('GBP');
    });

    it('marks the payload as manual so the stored raw records its origin', async () => {
      levyRepo.findOne.mockResolvedValue({
        accountId: null,
        balance: '1.00',
        currency: null,
        lastSyncedAt: new Date('2026-09-01T10:00:00.000Z'),
        rawPayload: null,
      });

      const result = await client.fetchLevyBalance('10001234');

      // das-levy-sync.service.ts persists this straight into rawPayload, so
      // this is the marker that survives into the database.
      expect(result.raw.source).toBe('manual');
      expect(result.raw.enteredAt).toBe('2026-09-01T10:00:00.000Z');
    });

    it('throws when no balance has been entered', async () => {
      levyRepo.findOne.mockResolvedValue(null);

      await expect(client.fetchLevyBalance('10001234')).rejects.toBeInstanceOf(
        DasManualDataMissingException,
      );
    });

    it('throws rather than returning a null balance as though it were zero', async () => {
      // A row can exist with no figure in it — a part-filled form. That is
      // still "no balance", and returning it would put an empty value where a
      // number belongs.
      levyRepo.findOne.mockResolvedValue({
        accountId: 'ACC-1',
        balance: null,
        currency: 'GBP',
        lastSyncedAt: new Date(),
        rawPayload: null,
      });

      await expect(client.fetchLevyBalance('10001234')).rejects.toBeInstanceOf(
        DasManualDataMissingException,
      );
    });

    it('names the UKPRN and the fix in the message', async () => {
      levyRepo.findOne.mockResolvedValue(null);

      // This message reaches an administrator through lastErrorMessage on the
      // sync-status card, so it has to say what to do.
      await expect(client.fetchLevyBalance('10001234')).rejects.toThrow(
        /10001234.*Settings → Levy data/s,
      );
    });
  });

  describe('fetchFundingPayments', () => {
    const organisation = { id: 'org-1', ukprn: '10001234' };

    it('returns manually-entered payments', async () => {
      organisationRepo.findOne.mockResolvedValue(organisation);
      paymentRepo.find.mockResolvedValue([
        {
          externalReference: 'PAY-1',
          paymentDate: '2026-08-01',
          amount: '500.00',
          currency: 'GBP',
          fundingPeriod: '2026-27',
          clawbackNotice: null,
          rawPayload: null,
        },
      ]);

      const rows = await client.fetchFundingPayments('10001234');

      expect(rows).toHaveLength(1);
      expect(rows[0].externalReference).toBe('PAY-1');
      expect(rows[0].raw.source).toBe('manual');
    });

    it('applies the from/to window', async () => {
      organisationRepo.findOne.mockResolvedValue(organisation);
      paymentRepo.find.mockResolvedValue([
        {
          externalReference: 'OLD',
          paymentDate: '2026-01-01',
          amount: '1.00',
          currency: 'GBP',
          fundingPeriod: null,
          clawbackNotice: null,
          rawPayload: null,
        },
        {
          externalReference: 'KEEP',
          paymentDate: '2026-08-01',
          amount: '2.00',
          currency: 'GBP',
          fundingPeriod: null,
          clawbackNotice: null,
          rawPayload: null,
        },
      ]);

      const rows = await client.fetchFundingPayments('10001234', {
        from: '2026-07-01',
      });

      expect(rows.map((r) => r.externalReference)).toEqual(['KEEP']);
    });

    it('throws when the UKPRN belongs to no organisation', async () => {
      organisationRepo.findOne.mockResolvedValue(null);

      await expect(
        client.fetchFundingPayments('99999999'),
      ).rejects.toBeInstanceOf(DasManualDataMissingException);
    });

    it('throws rather than returning an empty list', async () => {
      organisationRepo.findOne.mockResolvedValue(organisation);
      paymentRepo.find.mockResolvedValue([]);

      // "[]" would render as a confirmed nil return. In manual mode we cannot
      // tell "no payments received" from "nobody has entered any", and the
      // second read as the first is the expensive direction.
      await expect(
        client.fetchFundingPayments('10001234'),
      ).rejects.toBeInstanceOf(DasManualDataMissingException);
    });

    it('throws when every row falls outside the window', async () => {
      organisationRepo.findOne.mockResolvedValue(organisation);
      paymentRepo.find.mockResolvedValue([
        {
          externalReference: 'OLD',
          paymentDate: '2026-01-01',
          amount: '1.00',
          currency: 'GBP',
          fundingPeriod: null,
          clawbackNotice: null,
          rawPayload: null,
        },
      ]);

      await expect(
        client.fetchFundingPayments('10001234', { from: '2026-07-01' }),
      ).rejects.toBeInstanceOf(DasManualDataMissingException);
    });
  });

  /**
   * These four are requests *to* DAS. In manual mode there is nothing to send
   * them to, and a fabricated reference would be recorded against a learner as
   * evidence of a submission that never happened — surfacing much later as an
   * ILR mismatch nobody can trace back.
   */
  describe('operations that write to DAS', () => {
    it('refuses to submit an enrolment, and says where to record the real one', async () => {
      await expect(
        client.submitEnrolment({
          ukprn: '10001234',
          learnerRef: 'LR-1',
          standardCode: 'ST0116',
          givenNames: 'A',
          familyName: 'B',
          plannedStartDate: '2026-09-01',
          plannedEndDate: null,
        }),
      ).rejects.toThrow(/ilr-receipt/);
    });

    it('refuses to notify a completion', async () => {
      await expect(
        client.notifyCompletion({
          learnerRef: 'LR-1',
          completionDate: '2026-09-01',
          epaOutcome: 'pass',
        }),
      ).rejects.toBeInstanceOf(DasManualDataMissingException);
    });

    it('refuses to create a transfer consent', async () => {
      await expect(
        client.createLevyTransferConsent({
          amount: '1000.00',
          recipientAccount: 'ACC-2',
          startDate: '2026-09-01',
        }),
      ).rejects.toBeInstanceOf(DasManualDataMissingException);
    });

    it('refuses to report a transfer status', async () => {
      await expect(client.fetchTransferStatus('REF-1')).rejects.toBeInstanceOf(
        DasManualDataMissingException,
      );
    });

    it('never resolves with a synthesised reference', async () => {
      // The shape of the bug this guards: returning
      // { reference: 'MANUAL-123', status: 'accepted' } would satisfy every
      // caller and be entirely fictional.
      const results = await Promise.allSettled([
        client.submitEnrolment({
          ukprn: '1',
          learnerRef: 'L',
          standardCode: 'S',
          givenNames: 'A',
          familyName: 'B',
          plannedStartDate: '2026-09-01',
          plannedEndDate: null,
        }),
        client.notifyCompletion({
          learnerRef: 'L',
          completionDate: '2026-09-01',
          epaOutcome: null,
        }),
        client.createLevyTransferConsent({
          amount: '1',
          recipientAccount: 'A',
          startDate: '2026-09-01',
        }),
        client.fetchTransferStatus('REF'),
      ]);

      expect(results.every((r) => r.status === 'rejected')).toBe(true);
    });
  });
});
