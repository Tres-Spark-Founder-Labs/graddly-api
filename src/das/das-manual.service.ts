import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { IlrSubmission } from '../ilr/entities/ilr-submission.entity.js';
import { DasDonorLink } from '../levy-exchange/entities/das-donor-link.entity.js';
import { DasLevyTranche } from '../levy-exchange/entities/das-levy-tranche.entity.js';
import { DasDonorLinkStatus } from '../levy-exchange/enums/das-donor-link-status.enum.js';

import { DasFundingPayment } from './entities/das-funding-payment.entity.js';
import { DasLevyBalance } from './entities/das-levy-balance.entity.js';
import { DasLevyMonthlyEntry } from './entities/das-levy-monthly-entry.entity.js';
import { DasSyncStatus } from './enums/das-sync-status.enum.js';

import type {
  ManualDonorLinkDto,
  ManualFundingPaymentDto,
  ManualIlrReceiptDto,
  ManualLevyBalanceDto,
  ManualLevyMonthlyDto,
  ManualLevyTranchesDto,
} from './dto/manual-das.dto.js';

/**
 * Writes for deployments running without ESFA credentials.
 *
 * Every figure here was typed by a person, and every write records who through
 * the audit subscriber — `setCurrentUserId` is set by the controller before
 * calling in, and `DasLevyBalance`, `DasLevyMonthlyEntry`, `DasFundingPayment`,
 * `DasDonorLink`, `DasLevyTranche` and `IlrSubmission` are all audited entities.
 *
 * ── THE TWO BULK WRITES REPLACE, THEY DO NOT MERGE ──────────────────────────
 *
 * `replaceMonthlyEntries` and `replaceTranches` delete the existing set and
 * insert the new one inside a single transaction. Half a year of levy data is
 * worse than none: a twelve-month chart with three months missing still renders,
 * still looks right, and is wrong by whatever those three months contained.
 * Either the whole set lands or the previous set is untouched.
 */
@Injectable()
export class DasManualService {
  constructor(
    @InjectRepository(DasLevyBalance)
    private readonly levyRepo: Repository<DasLevyBalance>,
    @InjectRepository(DasFundingPayment)
    private readonly paymentRepo: Repository<DasFundingPayment>,
    @InjectRepository(DasDonorLink)
    private readonly donorLinkRepo: Repository<DasDonorLink>,
    @InjectRepository(IlrSubmission)
    private readonly ilrRepo: Repository<IlrSubmission>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * One row per organisation, following `das-levy-sync.service.ts findOrCreate`,
   * so a second submission corrects the figure rather than adding a second one
   * for the same organisation.
   */
  async setLevyBalance(
    organisationId: string,
    dto: ManualLevyBalanceDto,
  ): Promise<DasLevyBalance> {
    const existing = await this.levyRepo.findOne({
      where: { organisationId, isDeleted: false },
    });

    const record =
      existing ??
      this.levyRepo.create({
        organisationId,
        accountId: null,
        ukprn: null,
        rawPayload: null,
        utilisationSegments: null,
      });

    record.balance = dto.balance;
    record.currency = dto.currency ?? 'GBP';
    if (dto.accountId !== undefined) record.accountId = dto.accountId;
    if (dto.ukprn !== undefined) record.ukprn = dto.ukprn;

    /**
     * MANUAL, never SUCCESS. The sync-status card reads this one field, so
     * storing a hand-typed figure as a successful sync is the difference
     * between the card saying "Manually entered" and it claiming the
     * apprenticeship service confirmed this number.
     */
    record.lastSyncStatus = DasSyncStatus.MANUAL;
    record.lastSyncedAt = new Date();
    record.lastErrorMessage = null;

    return this.levyRepo.save(record);
  }

  /**
   * Replaces every monthly entry for the organisation. Not an upsert.
   *
   * The whole set moves in one transaction: a failure on month nine leaves the
   * previous twelve intact rather than eight new ones and four stale.
   */
  async replaceMonthlyEntries(
    organisationId: string,
    dto: ManualLevyMonthlyDto,
  ): Promise<number> {
    assertContiguousMonths(dto.months.map((m) => m.month));

    return this.dataSource.transaction(async (manager) => {
      await manager.delete(DasLevyMonthlyEntry, { organisationId });

      const rows = dto.months.map((m) =>
        manager.create(DasLevyMonthlyEntry, {
          organisationId,
          month: `${m.month}-01`,
          contributions: m.contributions,
          spend: m.spend,
          currency: m.currency ?? 'GBP',
        }),
      );
      const saved = await manager.save(rows);
      return saved.length;
    });
  }

  /**
   * Replaces every tranche on ONE donor link. Not an upsert, and scoped to the
   * link rather than the organisation.
   *
   * An organisation may hold several linked DAS accounts (F4.1.1 AC4), so
   * replacing by organisation would wipe a sibling entity's tranches as a side
   * effect of updating this one.
   */
  async replaceTranches(
    organisationId: string,
    dto: ManualLevyTranchesDto,
  ): Promise<number> {
    const link = await this.donorLinkRepo.findOne({
      where: { id: dto.donorLinkId, organisationId, isDeleted: false },
    });
    if (!link) {
      throw new NotFoundException(
        `No donor link ${dto.donorLinkId} for this organisation. ` +
          'Create the DAS account record first at POST /das/manual/donor-link.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.delete(DasLevyTranche, {
        organisationId,
        donorLinkId: link.id,
      });

      const rows = dto.tranches.map((t) =>
        manager.create(DasLevyTranche, {
          organisationId,
          donorLinkId: link.id,
          amount: t.amount,
          expiresOn: t.expiresOn,
          rawPayload: { source: 'manual' },
        }),
      );
      const saved = await manager.save(rows);
      return saved.length;
    });
  }

  /**
   * One payment. Keyed on `externalReference` per organisation, so re-entering
   * the same reference corrects that payment rather than double-counting it.
   */
  async recordFundingPayment(
    organisationId: string,
    dto: ManualFundingPaymentDto,
  ): Promise<DasFundingPayment> {
    const negative = dto.amount.trim().startsWith('-');
    if (negative && !dto.clawbackNotice?.trim()) {
      throw new BadRequestException(
        'A negative amount is a clawback and needs a clawbackNotice saying why ' +
          'the money was recovered.',
      );
    }

    const existing = await this.paymentRepo.findOne({
      where: {
        organisationId,
        externalReference: dto.externalReference,
        isDeleted: false,
      },
    });

    const record =
      existing ??
      this.paymentRepo.create({
        organisationId,
        externalReference: dto.externalReference,
        enrolmentId: null,
      });

    record.paymentDate = dto.paymentDate;
    record.amount = dto.amount;
    record.currency = dto.currency ?? 'GBP';
    record.fundingPeriod = dto.fundingPeriod ?? null;
    record.clawbackNotice = dto.clawbackNotice ?? null;
    record.rawPayload = { source: 'manual' };
    record.lastSyncedAt = new Date();

    return this.paymentRepo.save(record);
  }

  /**
   * Records the ESFA's response to a submission made outside the platform.
   *
   * The submission row already exists — the ILR was built here and filed
   * through the ESFA portal by hand. This writes back what came out the other
   * end. `submittedAt` is the ESFA's timestamp, not now(): the point of the
   * record is when the ESFA accepted it.
   */
  async recordIlrReceipt(
    organisationId: string,
    dto: ManualIlrReceiptDto,
  ): Promise<IlrSubmission> {
    const submission = await this.ilrRepo.findOne({
      where: { id: dto.submissionId, organisationId, isDeleted: false },
    });
    if (!submission) {
      throw new NotFoundException(
        `No ILR submission ${dto.submissionId} for this organisation.`,
      );
    }

    submission.esfaReference = dto.esfaReference;
    submission.submittedAt = new Date(dto.submittedAt);
    submission.receipt = {
      source: 'manual',
      esfaReference: dto.esfaReference,
      recordedAt: new Date().toISOString(),
    };

    return this.ilrRepo.save(submission);
  }

  /**
   * A DAS account recorded by hand.
   *
   * `status` is MANUAL rather than LINKED: no OAuth consent happened, and
   * nothing downstream should treat this as a live connection it can sync
   * against. Several per organisation is normal (F4.1.1 AC4).
   */
  async createDonorLink(
    organisationId: string,
    dto: ManualDonorLinkDto,
  ): Promise<DasDonorLink> {
    return this.donorLinkRepo.save(
      this.donorLinkRepo.create({
        organisationId,
        label: dto.label,
        dasAccountId: dto.dasAccountId ?? null,
        ukprn: dto.ukprn ?? null,
        status: DasDonorLinkStatus.MANUAL,
        lastErrorMessage: null,
        consentedAt: null,
        lastSyncedAt: dto.lastBalance ? new Date() : null,
        lastBalance: dto.lastBalance ?? null,
        lastRawPayload: { source: 'manual' },
      }),
    );
  }

  /** The links an operator can attach tranches to. */
  async listDonorLinks(organisationId: string): Promise<DasDonorLink[]> {
    return this.donorLinkRepo.find({
      where: { organisationId, isDeleted: false },
      order: { createdAt: 'ASC' },
    });
  }
}

/**
 * The months must form an unbroken run.
 *
 * Three ways a submission can be wrong, and they need different messages
 * because they have different causes:
 *
 *   duplicates   the same month twice — a paste that repeated a row
 *   gap          a month missing between two present ones — a dropped row
 *   (short set)  legal: a levy year in progress has fewer than twelve
 *
 * A gap is rejected rather than accepted-and-rendered because eleven months
 * plotted across a twelve-month axis is a trend that looks complete and is
 * not. A month in which the employer genuinely contributed nothing is
 * `0.00` — expressible, and distinguishable from absent.
 *
 * Gaps at either END are legal and reach here as a short set: a year part-way
 * through, or an employer who joined mid-year. Only interior gaps fail.
 */
export function assertContiguousMonths(months: string[]): void {
  const duplicates = months.filter((m, i) => months.indexOf(m) !== i);
  if (duplicates.length > 0) {
    throw new BadRequestException(
      `The same month appears more than once: ${[...new Set(duplicates)].join(', ')}. ` +
        'Each month may appear once.',
    );
  }

  const ordinal = (m: string): number => {
    const [year, month] = m.split('-').map(Number);
    return year * 12 + (month - 1);
  };

  const sorted = [...months].sort((a, b) => ordinal(a) - ordinal(b));
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = ordinal(sorted[i]) - ordinal(sorted[i - 1]);
    if (gap !== 1) {
      const missing = gap - 1;
      throw new BadRequestException(
        `${missing} month${missing === 1 ? ' is' : 's are'} missing between ` +
          `${sorted[i - 1]} and ${sorted[i]}. Months must run without a break — ` +
          'enter 0.00 for a month with no contribution rather than leaving it out.',
      );
    }
  }
}
