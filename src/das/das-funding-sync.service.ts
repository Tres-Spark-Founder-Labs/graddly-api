import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';

import { DAS_CLIENT } from './das-client.constants.js';
import { DasFundingPayment } from './entities/das-funding-payment.entity.js';

import type { IDasClient } from './interfaces/das.client.interface.js';

export interface IDasFundingSummary {
  totalReceived: number;
  lastPaymentDate: string | null;
  pendingClawbackCount: number;
  currency: string;
}

@Injectable()
export class DasFundingSyncService {
  constructor(
    @Inject(DAS_CLIENT)
    private readonly client: IDasClient,
    @InjectRepository(DasFundingPayment)
    private readonly paymentRepo: Repository<DasFundingPayment>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
  ) {}

  async syncOrganisation(
    organisationId: string,
    requestedByUserId?: string,
  ): Promise<number> {
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId, isDeleted: false },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    if (!organisation.ukprn) {
      throw new BadRequestException('Organisation has no UKPRN for DAS sync');
    }

    const payments = await this.client.fetchFundingPayments(organisation.ukprn);
    const syncedAt = new Date();

    for (const payment of payments) {
      const enrolmentId = await this.resolveEnrolmentId(
        organisationId,
        payment.learnerRef,
      );

      const existing = await this.paymentRepo.findOne({
        where: {
          organisationId,
          externalReference: payment.externalReference,
          isDeleted: false,
        },
      });

      if (existing) {
        existing.paymentDate = payment.paymentDate;
        existing.amount = payment.amount;
        existing.currency = payment.currency;
        existing.fundingPeriod = payment.fundingPeriod;
        existing.clawbackNotice = payment.clawbackNotice;
        existing.enrolmentId = enrolmentId;
        existing.rawPayload = {
          ...payment.raw,
          requestedByUserId: requestedByUserId ?? null,
        };
        existing.lastSyncedAt = syncedAt;
        await this.paymentRepo.save(existing);
      } else {
        await this.paymentRepo.save(
          this.paymentRepo.create({
            organisationId,
            enrolmentId,
            paymentDate: payment.paymentDate,
            amount: payment.amount,
            currency: payment.currency,
            fundingPeriod: payment.fundingPeriod,
            clawbackNotice: payment.clawbackNotice,
            externalReference: payment.externalReference,
            rawPayload: {
              ...payment.raw,
              requestedByUserId: requestedByUserId ?? null,
            },
            lastSyncedAt: syncedAt,
          }),
        );
      }
    }

    return payments.length;
  }

  async getFundingSummary(organisationId: string): Promise<IDasFundingSummary> {
    const payments = await this.paymentRepo.find({
      where: { organisationId, isDeleted: false },
      order: { paymentDate: 'DESC' },
    });

    if (payments.length === 0) {
      return {
        totalReceived: 0,
        lastPaymentDate: null,
        pendingClawbackCount: 0,
        currency: 'GBP',
      };
    }

    const totalReceived = payments.reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    );
    const pendingClawbackCount = payments.filter(
      (row) => row.clawbackNotice && row.clawbackNotice.trim().length > 0,
    ).length;

    return {
      totalReceived: Math.round(totalReceived * 100) / 100,
      lastPaymentDate: payments[0].paymentDate,
      pendingClawbackCount,
      currency: payments[0].currency ?? 'GBP',
    };
  }

  async listPayments(
    organisationId: string,
    query: PaginationQueryDto & { from?: string; to?: string },
  ): Promise<PaginatedResult<DasFundingPayment>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const qb = this.paymentRepo
      .createQueryBuilder('payment')
      .where('payment.organisationId = :organisationId', { organisationId })
      .andWhere('payment.isDeleted = false')
      .orderBy('payment.paymentDate', 'DESC');

    if (query.from) {
      qb.andWhere('payment.paymentDate >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('payment.paymentDate <= :to', { to: query.to });
    }

    const [items, total] = await qb
      .skip((page - 1) * perPage)
      .take(perPage)
      .getManyAndCount();

    return new PaginatedResult(
      items,
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  deriveFundingClaimStatus(
    summary: IDasFundingSummary,
  ): 'synced' | 'no_payments' | 'clawback_pending' {
    if (summary.pendingClawbackCount > 0) {
      return 'clawback_pending';
    }
    if (!summary.lastPaymentDate) {
      return 'no_payments';
    }
    return 'synced';
  }

  private async resolveEnrolmentId(
    organisationId: string,
    learnerRef: string | null,
  ): Promise<string | null> {
    if (!learnerRef?.trim()) {
      return null;
    }

    const enrolment = await this.enrolmentRepo
      .createQueryBuilder('enrolment')
      .innerJoin('enrolment.apprentice', 'apprentice')
      .where('enrolment.organisationId = :organisationId', { organisationId })
      .andWhere('enrolment.isDeleted = false')
      .andWhere(
        '(LOWER(apprentice.email) = :ref OR enrolment.id::text = :rawRef)',
        { ref: learnerRef.trim().toLowerCase(), rawRef: learnerRef.trim() },
      )
      .getOne();

    return enrolment?.id ?? null;
  }
}
