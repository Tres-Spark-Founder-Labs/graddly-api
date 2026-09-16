import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { withRlsBootstrap } from '../../common/context/correlation-id-context.js';
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
    callerOrganisationId,
    attributedAmount = null,
  }: {
    transferId: string;
    enrolmentId: string;
    callerOrganisationId: string;
    attributedAmount?: string | null;
  }): Promise<LevyTransferEnrolment> {
    /**
     * The caller must own the enrolment — the rule levy_transfer_enrolments_insert
     * states. Checked here as well as by that policy: this route used to run
     * with RLS off and nothing looked at the caller, so any organisation could
     * attach a learner to a transfer. Answered as "not found" either way, so
     * the route cannot be used to probe for other organisations' enrolments.
     */
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, isDeleted: false },
    });
    if (!enrolment || enrolment.organisationId !== callerOrganisationId) {
      throw new NotFoundException('Enrolment not found');
    }

    /**
     * The enrolment's employer must be the party the transfer was made to.
     * `employerOrganisationId` is nullable, and a null must fail rather than
     * pass — an unlinked enrolment is not evidence that it belongs to the
     * recipient.
     */
    if (!enrolment.employerOrganisationId) {
      throw new BadRequestException(
        'This enrolment does not belong to the employer that received the transfer.',
      );
    }

    /**
     * Only now the transfer, and only because the caller has already been
     * authorised on something it does own: the enrolment above, read under
     * RLS. The caller is normally the training provider, which is party to the
     * enrolment and not to the transfer, so `levy_transfers_select` does not
     * show it the row — the counterparty case of the bootstrap rule on
     * `withRlsBootstrap`, four named columns.
     */
    const transfer = await this.transferForLink(transferId);
    if (
      !transfer ||
      transfer.recipientOrganisationId !== enrolment.employerOrganisationId
    ) {
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

  /**
   * The transfer, for a caller already authorised on its own enrolment.
   *
   * Named columns only: the status this link depends on and the two parties it
   * is checked against. Nothing else about the transfer — not its amount, not
   * its ESFA reference — is read into a request made by an organisation that
   * is not a party to it.
   */
  private async transferForLink(
    transferId: string,
  ): Promise<LevyTransfer | null> {
    return withRlsBootstrap(async () => {
      return this.transferRepo.findOne({
        where: { id: transferId, isDeleted: false },
        select: [
          'id',
          'status',
          'donorOrganisationId',
          'recipientOrganisationId',
        ],
      });
    });
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
    await this.assertUnlinked(existing.id);
  }

  /**
   * levy_transfer_enrolments_select shows the link to the donor and the
   * recipient, but levy_transfer_enrolments_update admits only the enrolment's
   * owner. Under RLS the refused UPDATE affects no rows and save() does not say
   * so, and this route answered with its success envelope over an untouched
   * row. The read-back is what turns that into an answer, the way
   * assertDocumentSigned does for the agreement.
   */
  private async assertUnlinked(id: string): Promise<void> {
    const row = await this.linkRepo.findOne({
      where: { id },
      select: ['id', 'isDeleted'],
    });
    if (!row?.isDeleted) {
      throw new ForbiddenException(
        'Only the organisation that owns the enrolment can unlink it',
      );
    }
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
