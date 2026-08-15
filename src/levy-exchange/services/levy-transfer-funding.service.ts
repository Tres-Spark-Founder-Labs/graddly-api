import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrolment } from '../../enrolments/entities/enrolment.entity.js';
import { LevyTransferEnrolment } from '../entities/levy-transfer-enrolment.entity.js';
import { LevyTransfer } from '../entities/levy-transfer.entity.js';
import { LevyTransferStatus } from '../enums/levy-transfer-status.enum.js';

/**
 * The link between a levy transfer and the enrolments it funded (F4.1.4 AC1).
 *
 * ── WHY THE VALIDATION IS STRICT ────────────────────────────────────────────
 *
 * Everything recorded here ends up in a figure a donor publishes. AC4 exports
 * the analytics "for inclusion in annual ESG or social value reports", so a
 * learner counted here is a claim made to a donor's stakeholders. Three rules
 * follow, and each rejects rather than tolerates:
 *
 *   1. The transfer must actually be funding something — `confirmed` or
 *      `active`. A draft or failed transfer has not paid for anything.
 *   2. The enrolment's employer must be the transfer's recipient. Without this
 *      a provider could attach a transfer to any learner on their books,
 *      including one belonging to a different employer entirely.
 *   3. The same pair cannot be linked twice. Enforced by a partial unique
 *      index as well, because a race between two requests would otherwise
 *      double-count a learner.
 */
@Injectable()
export class LevyTransferFundingService {
  constructor(
    @InjectRepository(LevyTransferEnrolment)
    private readonly linkRepo: Repository<LevyTransferEnrolment>,
    @InjectRepository(LevyTransfer)
    private readonly transferRepo: Repository<LevyTransfer>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
  ) {}

  /**
   * Records that `transferId` funded `enrolmentId`.
   *
   * Idempotent: linking the same pair again returns the existing row rather
   * than throwing. A provider re-submitting an enrolment form should not get
   * an error, and the caller should not have to check first.
   */
  async link({
    transferId,
    enrolmentId,
    attributedAmount = null,
  }: {
    transferId: string;
    enrolmentId: string;
    attributedAmount?: string | null;
  }): Promise<LevyTransferEnrolment> {
    const transfer = await this.transferRepo.findOne({
      where: { id: transferId, isDeleted: false },
    });
    if (!transfer) {
      throw new NotFoundException('Levy transfer not found');
    }

    const fundingStatuses = [
      LevyTransferStatus.CONFIRMED,
      LevyTransferStatus.ACTIVE,
    ];
    if (!fundingStatuses.includes(transfer.status)) {
      throw new BadRequestException(
        `A transfer can only fund an enrolment once it is confirmed. ` +
          `This one is "${transfer.status}".`,
      );
    }

    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, isDeleted: false },
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }

    /**
     * The enrolment's employer must be the party the transfer was made to.
     * `employerOrganisationId` is nullable, and a null must fail rather than
     * pass — an unlinked enrolment is not evidence that it belongs to the
     * recipient.
     */
    if (
      !enrolment.employerOrganisationId ||
      enrolment.employerOrganisationId !== transfer.recipientOrganisationId
    ) {
      throw new BadRequestException(
        'This enrolment does not belong to the employer that received the transfer.',
      );
    }

    const existing = await this.linkRepo.findOne({
      where: { transferId, enrolmentId, isDeleted: false },
    });
    if (existing) {
      return existing;
    }

    return this.linkRepo.save(
      this.linkRepo.create({
        transferId,
        enrolmentId,
        donorOrganisationId: transfer.donorOrganisationId,
        attributedAmount,
      }),
    );
  }

  async unlink(transferId: string, enrolmentId: string): Promise<void> {
    const existing = await this.linkRepo.findOne({
      where: { transferId, enrolmentId, isDeleted: false },
    });
    if (!existing) {
      throw new NotFoundException(
        'This enrolment is not linked to that transfer',
      );
    }
    existing.isDeleted = true;
    await this.linkRepo.save(existing);
  }

  /** Enrolments funded by one transfer. */
  async listForTransfer(transferId: string): Promise<LevyTransferEnrolment[]> {
    return this.linkRepo.find({
      where: { transferId, isDeleted: false },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * F4.1.4 AC1 — the donor's headline figures.
   *
   * Counts **distinct** enrolments and recipients. A learner funded by two of
   * the same donor's transfers is one learner, not two; the distinct count is
   * the difference between a defensible number and an inflated one.
   */
  async countForDonor(donorOrganisationId: string): Promise<{
    learnersFunded: number;
    transfersWithLearners: number;
  }> {
    const row = await this.linkRepo
      .createQueryBuilder('link')
      .select('COUNT(DISTINCT link.enrolmentId)', 'learners')
      .addSelect('COUNT(DISTINCT link.transferId)', 'transfers')
      .where('link.donorOrganisationId = :donorOrganisationId', {
        donorOrganisationId,
      })
      .andWhere('link.isDeleted = false')
      .getRawOne<{ learners: string; transfers: string }>();

    return {
      learnersFunded: Number(row?.learners ?? 0),
      transfersWithLearners: Number(row?.transfers ?? 0),
    };
  }

  /** The enrolment ids a donor has funded, for joining into other metrics. */
  async fundedEnrolmentIds(donorOrganisationId: string): Promise<string[]> {
    const rows = await this.linkRepo
      .createQueryBuilder('link')
      .select('DISTINCT link.enrolmentId', 'enrolmentId')
      .where('link.donorOrganisationId = :donorOrganisationId', {
        donorOrganisationId,
      })
      .andWhere('link.isDeleted = false')
      .getRawMany<{ enrolmentId: string }>();

    return rows.map((r) => r.enrolmentId);
  }
}
