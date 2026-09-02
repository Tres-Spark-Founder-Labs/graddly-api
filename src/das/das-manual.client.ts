import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Organisation } from '../organisations/entities/organisation.entity.js';

import { DasFundingPayment } from './entities/das-funding-payment.entity.js';
import { DasLevyBalance } from './entities/das-levy-balance.entity.js';
import { DasManualDataMissingException } from './exceptions/das-manual-data-missing.exception.js';

import type {
  IDasCompletionNotificationRequest,
  IDasCompletionNotificationResult,
  IDasEnrolmentSubmissionRequest,
  IDasEnrolmentSubmissionResult,
  IDasFundingPaymentPayload,
  IDasFundingPaymentsQuery,
  IDasLevyBalancePayload,
  IDasTransferConsentRequest,
  IDasTransferConsentResult,
  IDasTransferStatusPayload,
} from './das.types.js';
import type { IDasClient } from './interfaces/das.client.interface.js';

/**
 * `IDasClient` for deployments with no ESFA credentials.
 *
 * Serves figures an administrator entered through `/das/manual/*` instead of
 * calling the apprenticeship service. Getting DAS API access takes weeks; this
 * is what makes the rest of the platform usable in the meantime.
 *
 * ── IT NEVER INVENTS A NUMBER ───────────────────────────────────────────────
 *
 * Every method either returns something a named person typed, or throws
 * `DasManualDataMissingException`. There is no zero, no empty array standing in
 * for "unknown", and no synthesised reference. A levy balance is a figure
 * employers commit money against, so a plausible-looking guess is worse here
 * than an error — the error is visible and a wrong balance is not.
 *
 * ── READS AND WRITES DIFFER ─────────────────────────────────────────────────
 *
 * The two read methods have somewhere to read from. The four write methods —
 * enrolment submission, completion notification, transfer consent and transfer
 * status — are requests *to* DAS, and in manual mode there is no DAS to send
 * them to. They cannot be faked into succeeding: a fabricated submission
 * reference would be recorded against a learner as proof of something that
 * never happened, and would surface later as an ILR mismatch nobody could
 * trace. They throw, naming the manual route for recording the real outcome.
 */
@Injectable()
export class DasManualClient implements IDasClient {
  constructor(
    @InjectRepository(DasLevyBalance)
    private readonly levyRepo: Repository<DasLevyBalance>,
    @InjectRepository(DasFundingPayment)
    private readonly paymentRepo: Repository<DasFundingPayment>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
  ) {}

  /**
   * The manually-entered balance for the organisation holding this UKPRN.
   *
   * `raw` carries `source: 'manual'` so anything that persists the payload
   * records where the figure came from. `das-levy-sync.service.ts` writes
   * `rawPayload` straight from here, so this is the marker that survives into
   * the database.
   */
  async fetchLevyBalance(ukprn: string): Promise<IDasLevyBalancePayload> {
    const record = await this.levyRepo.findOne({
      where: { ukprn, isDeleted: false },
      order: { updatedAt: 'DESC' },
    });

    if (!record || record.balance === null) {
      throw new DasManualDataMissingException('levy balance', undefined, ukprn);
    }

    return {
      accountId: record.accountId,
      balance: record.balance,
      currency: record.currency ?? 'GBP',
      raw: {
        source: 'manual',
        enteredAt: record.lastSyncedAt?.toISOString() ?? null,
        ...(record.rawPayload ?? {}),
      },
    };
  }

  /**
   * Manually-entered funding payments, newest first.
   *
   * Throws when there are none rather than returning `[]`. In manual mode the
   * two states "this employer has received no payments" and "nobody has
   * entered any yet" are indistinguishable from here, and an empty table
   * reading as a confirmed nil return is the more expensive mistake.
   */
  async fetchFundingPayments(
    ukprn: string,
    query: IDasFundingPaymentsQuery = {},
  ): Promise<IDasFundingPaymentPayload[]> {
    const organisation = await this.organisationRepo.findOne({
      where: { ukprn, isDeleted: false },
    });

    if (!organisation) {
      throw new DasManualDataMissingException(
        'funding payment',
        'No organisation holds this UKPRN.',
        ukprn,
      );
    }

    const rows = await this.paymentRepo.find({
      where: { organisationId: organisation.id, isDeleted: false },
      order: { paymentDate: 'DESC' },
    });

    const filtered = rows.filter((row) => {
      if (query.from && row.paymentDate < query.from) return false;
      if (query.to && row.paymentDate > query.to) return false;
      return true;
    });

    if (filtered.length === 0) {
      throw new DasManualDataMissingException(
        'funding payment',
        'Enter payments under Settings → Levy data.',
        ukprn,
      );
    }

    return filtered.map((row) => ({
      externalReference: row.externalReference,
      paymentDate: row.paymentDate,
      amount: row.amount,
      currency: row.currency,
      fundingPeriod: row.fundingPeriod,
      clawbackNotice: row.clawbackNotice,
      learnerRef: null,
      raw: { source: 'manual', ...(row.rawPayload ?? {}) },
    }));
  }

  // ── Writes to DAS. There is no DAS. ───────────────────────────────────────

  createLevyTransferConsent(
    _request: IDasTransferConsentRequest,
  ): Promise<IDasTransferConsentResult> {
    return Promise.reject(
      new DasManualDataMissingException(
        'levy transfer consent',
        'Transfer consent must be granted in the apprenticeship service. ' +
          'Gradlly cannot request it without DAS credentials.',
      ),
    );
  }

  fetchTransferStatus(reference: string): Promise<IDasTransferStatusPayload> {
    return Promise.reject(
      new DasManualDataMissingException(
        'transfer status',
        'Check the transfer in the apprenticeship service.',
        reference,
      ),
    );
  }

  submitEnrolment(
    request: IDasEnrolmentSubmissionRequest,
  ): Promise<IDasEnrolmentSubmissionResult> {
    return Promise.reject(
      new DasManualDataMissingException(
        'enrolment submission',
        'Submit the ILR through the ESFA portal, then record the receipt at ' +
          'POST /das/manual/ilr-receipt.',
        request.learnerRef,
      ),
    );
  }

  notifyCompletion(
    request: IDasCompletionNotificationRequest,
  ): Promise<IDasCompletionNotificationResult> {
    return Promise.reject(
      new DasManualDataMissingException(
        'completion notification',
        'Record the completion in the apprenticeship service, then log the ' +
          'receipt at POST /das/manual/ilr-receipt.',
        request.learnerRef,
      ),
    );
  }
}
