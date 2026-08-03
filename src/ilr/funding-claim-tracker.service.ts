import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { DasFundingPayment } from '../das/entities/das-funding-payment.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';

import { FundingClaimResolution } from './entities/funding-claim-resolution.entity.js';
import {
  FundingClaimDiscrepancy,
  FundingClaimResolutionStatus,
} from './enums/funding-claim-discrepancy.enum.js';

import type { FundingClaimResponseDto } from './dto/funding-claim-response.dto.js';
import type { ListFundingClaimsQueryDto } from './dto/list-funding-claims-query.dto.js';
import type { UpdateFundingClaimResolutionDto } from './dto/update-funding-claim-resolution.dto.js';
import type { IPaginationMeta } from '../common/pagination/pagination-meta.interface.js';

/**
 * Money is compared in pence, as integers.
 *
 * `agreedPrice` and payment amounts are both numeric strings from Postgres.
 * Parsing them to floats and subtracting produces 0.009999999999990905 on
 * perfectly reconciled claims, which would then be reported as a discrepancy.
 */
function toPence(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  return Math.round(Number(value) * 100);
}

function toPounds(pence: number): number {
  return Math.round(pence) / 100;
}

/**
 * F2.3.2 AC7 — the funding claim tracker.
 *
 * Claimed, received and the discrepancy are all computed on read from data
 * the platform already holds. Only the resolution status is stored.
 */
@Injectable()
export class FundingClaimTrackerService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(DasFundingPayment)
    private readonly paymentRepo: Repository<DasFundingPayment>,
    @InjectRepository(FundingClaimResolution)
    private readonly resolutionRepo: Repository<FundingClaimResolution>,
  ) {}

  async list(
    organisationId: string,
    query: ListFundingClaimsQueryDto,
  ): Promise<{ items: FundingClaimResponseDto[]; meta: IPaginationMeta }> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    // Cancelled enrolments are excluded: there is no claim to reconcile
    // against an apprenticeship that never ran.
    const [enrolments, total] = await this.enrolmentRepo.findAndCount({
      where: {
        organisationId,
        isDeleted: false,
        status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.COMPLETED]),
      },
      relations: ['apprentice', 'standard'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    if (enrolments.length === 0) {
      return { items: [], meta: buildPaginationMeta({ total, page, perPage }) };
    }

    const enrolmentIds = enrolments.map((e) => e.id);
    const [payments, resolutions] = await Promise.all([
      this.paymentRepo.find({
        where: { organisationId, enrolmentId: In(enrolmentIds) },
      }),
      this.resolutionRepo.find({
        where: {
          organisationId,
          enrolmentId: In(enrolmentIds),
          isDeleted: false,
        },
      }),
    ]);

    const resolutionByEnrolment = new Map(
      resolutions.map((r) => [r.enrolmentId, r]),
    );

    const paymentsByEnrolment = new Map<string, DasFundingPayment[]>();
    for (const payment of payments) {
      if (!payment.enrolmentId) {
        continue;
      }
      const list = paymentsByEnrolment.get(payment.enrolmentId) ?? [];
      list.push(payment);
      paymentsByEnrolment.set(payment.enrolmentId, list);
    }

    const items = enrolments
      .map((enrolment) =>
        this.buildClaim(
          enrolment,
          paymentsByEnrolment.get(enrolment.id) ?? [],
          resolutionByEnrolment.get(enrolment.id) ?? null,
        ),
      )
      .filter((claim) =>
        query.discrepanciesOnly === 'true'
          ? claim.discrepancy !== FundingClaimDiscrepancy.NONE
          : true,
      );

    return { items, meta: buildPaginationMeta({ total, page, perPage }) };
  }

  /**
   * Record where a provider has got to with a discrepancy.
   *
   * Upserts: the first time anyone engages with a claim there is no row, and
   * requiring a create-then-update dance would put an empty-state branch in
   * every caller.
   */
  async setResolution(
    organisationId: string,
    enrolmentId: string,
    userId: string,
    dto: UpdateFundingClaimResolutionDto,
  ): Promise<FundingClaimResponseDto> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
      relations: ['apprentice', 'standard'],
    });
    if (!enrolment) {
      throw new BadRequestException('Enrolment not found');
    }

    const isClosing =
      dto.status === FundingClaimResolutionStatus.RESOLVED ||
      dto.status === FundingClaimResolutionStatus.WRITTEN_OFF;

    /**
     * A note is required to close a claim, not to open one.
     *
     * "Resolved" with no explanation is unauditable: an ESFA reconciliation
     * asks why a four-thousand-pound gap was closed, and "someone clicked
     * resolved" is not an answer. Moving a claim to investigating needs no
     * such justification.
     */
    if (isClosing && !dto.note?.trim()) {
      throw new BadRequestException(
        'A note is required when resolving or writing off a funding claim',
      );
    }

    const existing = await this.resolutionRepo.findOne({
      where: { organisationId, enrolmentId, isDeleted: false },
    });

    const record =
      existing ??
      this.resolutionRepo.create({
        organisationId,
        enrolmentId,
      });

    record.status = dto.status;
    record.note = dto.note?.trim() || null;
    record.updatedByUserId = userId;
    record.closedAt = isClosing ? new Date() : null;

    const saved = await this.resolutionRepo.save(record);

    const payments = await this.paymentRepo.find({
      where: { organisationId, enrolmentId },
    });

    return this.buildClaim(enrolment, payments, saved);
  }

  private buildClaim(
    enrolment: Enrolment,
    payments: DasFundingPayment[],
    resolution: FundingClaimResolution | null,
  ): FundingClaimResponseDto {
    const claimedPence = toPence(enrolment.agreedPrice);
    const receivedPence = payments.reduce(
      (sum, payment) => sum + toPence(payment.amount),
      0,
    );
    const clawbackNotices = payments
      .map((p) => p.clawbackNotice)
      .filter((notice): notice is string => !!notice);

    const discrepancy = this.classify({
      claimedPence,
      receivedPence,
      hasClawback: clawbackNotices.length > 0,
      isCompleted: enrolment.status === EnrolmentStatus.COMPLETED,
    });

    return {
      enrolmentId: enrolment.id,
      apprenticeName: `${enrolment.apprentice?.firstName ?? ''} ${
        enrolment.apprentice?.lastName ?? ''
      }`.trim(),
      standardTitle: enrolment.standard?.title ?? null,
      enrolmentStatus: enrolment.status,
      claimedAmount: toPounds(claimedPence),
      receivedAmount: toPounds(receivedPence),
      // Signed: negative is a shortfall, positive an overpayment. A caller
      // reading an absolute value cannot tell which way the money went.
      varianceAmount: toPounds(receivedPence - claimedPence),
      paymentCount: payments.length,
      clawbackNotices,
      discrepancy,
      resolutionStatus:
        resolution?.status ??
        (discrepancy === FundingClaimDiscrepancy.NONE
          ? null
          : FundingClaimResolutionStatus.OPEN),
      resolutionNote: resolution?.note ?? null,
      resolvedAt: resolution?.closedAt?.toISOString() ?? null,
    };
  }

  /**
   * The judgement that decides whether this tracker is useful.
   *
   * Apprenticeship funding arrives monthly across the programme, so an active
   * learner has received a fraction of the agreed price by design. Treating
   * `received < claimed` as a discrepancy would flag every in-flight learner
   * on the platform, and a tracker that flags everything flags nothing.
   */
  private classify({
    claimedPence,
    receivedPence,
    hasClawback,
    isCompleted,
  }: {
    claimedPence: number;
    receivedPence: number;
    hasClawback: boolean;
    isCompleted: boolean;
  }): FundingClaimDiscrepancy {
    // A clawback outranks the arithmetic: money is being reclaimed and
    // somebody has to answer for it, whatever the totals say.
    if (hasClawback) {
      return FundingClaimDiscrepancy.CLAWBACK;
    }
    if (receivedPence > claimedPence) {
      return FundingClaimDiscrepancy.OVERPAYMENT;
    }
    // Only once the programme is finished does an underpayment mean anything.
    if (isCompleted && receivedPence < claimedPence) {
      return FundingClaimDiscrepancy.SHORTFALL;
    }
    return FundingClaimDiscrepancy.NONE;
  }
}
