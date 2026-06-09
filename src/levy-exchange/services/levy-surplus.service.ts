import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { DasLevyForecastService } from '../../das/das-levy-forecast.service.js';
import { LevyExpiryCalendarEntryDto } from '../dto/levy-expiry-calendar-entry.dto.js';
import { LevySurplusResponseDto } from '../dto/levy-surplus-response.dto.js';
import { DasDonorLink } from '../entities/das-donor-link.entity.js';
import { DasLevyTranche } from '../entities/das-levy-tranche.entity.js';
import { LevySurplusSnapshot } from '../entities/levy-surplus-snapshot.entity.js';
import { LevyTransfer } from '../entities/levy-transfer.entity.js';
import { DasDonorLinkStatus } from '../enums/das-donor-link-status.enum.js';
import { LevyTransferStatus } from '../enums/levy-transfer-status.enum.js';

export type LevySurplusSummary = {
  organisationId: string;
  availableSurplus: string;
  computedAt: Date;
};

const TRANSFERRED_STATUSES = [
  LevyTransferStatus.PENDING_SIGNATURES,
  LevyTransferStatus.PENDING_ESFA,
  LevyTransferStatus.CONFIRMED,
  LevyTransferStatus.ACTIVE,
];

const SURPLUS_CAP_RATIO = 0.5;
const EXPIRY_CALENDAR_MONTHS = 24;

@Injectable()
export class LevySurplusService {
  constructor(
    @InjectRepository(DasDonorLink)
    private readonly donorLinkRepo: Repository<DasDonorLink>,
    @InjectRepository(DasLevyTranche)
    private readonly trancheRepo: Repository<DasLevyTranche>,
    @InjectRepository(LevySurplusSnapshot)
    private readonly snapshotRepo: Repository<LevySurplusSnapshot>,
    @InjectRepository(LevyTransfer)
    private readonly transferRepo: Repository<LevyTransfer>,
    private readonly forecastService: DasLevyForecastService,
  ) {}

  async getSurplus(organisationId: string): Promise<LevySurplusResponseDto[]> {
    const links = await this.findLinkedDonorLinks(organisationId);
    if (links.length === 0) {
      return [];
    }

    const snapshots = await this.loadLatestSnapshots(organisationId, links);
    return links.map((link) => {
      const snapshot = snapshots.get(link.id);
      return {
        donorLinkId: link.id,
        donorLinkLabel: link.label,
        totalBalance: snapshot?.totalBalance ?? '0.00',
        committedToOwnApprenticeships:
          snapshot?.committedToOwnApprenticeships ?? '0.00',
        maxTransferable: snapshot?.maxTransferable ?? '0.00',
        alreadyTransferred: snapshot?.alreadyTransferred ?? '0.00',
        availableSurplus: snapshot?.availableSurplus ?? '0.00',
        computedAt: snapshot?.computedAt.toISOString() ?? null,
      };
    });
  }

  async getExpiryCalendar(
    organisationId: string,
  ): Promise<LevyExpiryCalendarEntryDto[]> {
    const links = await this.findLinkedDonorLinks(organisationId);
    if (links.length === 0) {
      return [];
    }

    const linkIds = links.map((link) => link.id);
    const linkLabels = new Map(links.map((link) => [link.id, link.label]));
    const windowStart = this.utcDateOnly(new Date());
    const windowEnd = new Date(windowStart);
    windowEnd.setUTCMonth(windowEnd.getUTCMonth() + EXPIRY_CALENDAR_MONTHS);

    const tranches = await this.trancheRepo.find({
      where: {
        organisationId,
        donorLinkId: In(linkIds),
        isDeleted: false,
      },
      order: { expiresOn: 'ASC' },
    });

    const grouped = new Map<string, LevyExpiryCalendarEntryDto>();
    for (const tranche of tranches) {
      const expiresOn = tranche.expiresOn;
      if (expiresOn < this.formatDateOnly(windowStart)) {
        continue;
      }
      if (expiresOn > this.formatDateOnly(windowEnd)) {
        continue;
      }

      const month = expiresOn.slice(0, 7);
      const entry =
        grouped.get(month) ??
        ({
          month,
          totalAmount: '0.00',
          tranches: [],
        } satisfies LevyExpiryCalendarEntryDto);

      entry.tranches.push({
        trancheId: tranche.id,
        donorLinkId: tranche.donorLinkId,
        donorLinkLabel: linkLabels.get(tranche.donorLinkId) ?? null,
        amount: tranche.amount,
        expiresOn: tranche.expiresOn,
      });
      entry.totalAmount = this.formatAmount(
        Number(entry.totalAmount) + Number(tranche.amount),
      );
      grouped.set(month, entry);
    }

    return [...grouped.values()].sort((a, b) => a.month.localeCompare(b.month));
  }

  async recompute(organisationId: string): Promise<LevySurplusResponseDto[]> {
    const links = await this.findLinkedDonorLinks(organisationId);
    if (links.length === 0) {
      return [];
    }

    const forecast =
      await this.forecastService.forecastForOrganisation(organisationId);
    const committed = this.formatAmount(
      forecast.projectedMonthlySpend * forecast.horizonMonths +
        forecast.projectedCompletionLiability,
    );
    const alreadyTransferred = await this.sumAlreadyTransferred(organisationId);
    const computedAt = new Date();

    const snapshots: LevySurplusSnapshot[] = [];
    for (const link of links) {
      const metrics = this.computeMetrics(
        link.lastBalance,
        committed,
        alreadyTransferred,
      );
      snapshots.push(
        this.snapshotRepo.create({
          organisationId,
          donorLinkId: link.id,
          totalBalance: metrics.totalBalance,
          committedToOwnApprenticeships: committed,
          maxTransferable: metrics.maxTransferable,
          alreadyTransferred,
          availableSurplus: metrics.availableSurplus,
          computedAt,
        }),
      );
    }

    await this.snapshotRepo.save(snapshots);

    return links.map((link, index) => ({
      donorLinkId: link.id,
      donorLinkLabel: link.label,
      totalBalance: snapshots[index].totalBalance,
      committedToOwnApprenticeships:
        snapshots[index].committedToOwnApprenticeships,
      maxTransferable: snapshots[index].maxTransferable,
      alreadyTransferred: snapshots[index].alreadyTransferred,
      availableSurplus: snapshots[index].availableSurplus,
      computedAt: computedAt.toISOString(),
    }));
  }

  async getLatestForOrganisation(
    organisationId: string,
  ): Promise<LevySurplusSummary | null> {
    const snapshot = await this.snapshotRepo.findOne({
      where: { organisationId, isDeleted: false },
      order: { computedAt: 'DESC' },
    });
    if (!snapshot) {
      return null;
    }
    return this.toSummary(snapshot);
  }

  async getLatestForOrganisations(
    organisationIds: string[],
  ): Promise<Map<string, LevySurplusSummary>> {
    if (organisationIds.length === 0) {
      return new Map();
    }

    const snapshots = await this.snapshotRepo
      .createQueryBuilder('s')
      .distinctOn(['s.organisationId'])
      .where('s.isDeleted = false')
      .andWhere('s.organisationId IN (:...organisationIds)', {
        organisationIds,
      })
      .orderBy('s.organisationId', 'ASC')
      .addOrderBy('s.computedAt', 'DESC')
      .getMany();

    const map = new Map<string, LevySurplusSummary>();
    for (const snapshot of snapshots) {
      map.set(snapshot.organisationId, this.toSummary(snapshot));
    }
    return map;
  }

  async hasAvailableSurplus(
    organisationId: string,
    minimumAmount: string,
  ): Promise<boolean> {
    const summary = await this.getLatestForOrganisation(organisationId);
    if (!summary) {
      return false;
    }
    return this.compareAmounts(summary.availableSurplus, minimumAmount) >= 0;
  }

  compareAmounts(left: string, right: string): number {
    return Number.parseFloat(left) - Number.parseFloat(right);
  }

  minAmount(left: string, right: string): string {
    return this.compareAmounts(left, right) <= 0 ? left : right;
  }

  private async findLinkedDonorLinks(
    organisationId: string,
  ): Promise<DasDonorLink[]> {
    return this.donorLinkRepo.find({
      where: {
        organisationId,
        status: DasDonorLinkStatus.LINKED,
        isDeleted: false,
      },
      order: { createdAt: 'ASC' },
    });
  }

  private async loadLatestSnapshots(
    organisationId: string,
    links: DasDonorLink[],
  ): Promise<Map<string, LevySurplusSnapshot>> {
    const linkIds = links.map((link) => link.id);
    const rows = await this.snapshotRepo.find({
      where: {
        organisationId,
        donorLinkId: In(linkIds),
        isDeleted: false,
      },
      order: { computedAt: 'DESC' },
    });

    const latest = new Map<string, LevySurplusSnapshot>();
    for (const row of rows) {
      if (!latest.has(row.donorLinkId)) {
        latest.set(row.donorLinkId, row);
      }
    }
    return latest;
  }

  private async sumAlreadyTransferred(organisationId: string): Promise<string> {
    const transfers = await this.transferRepo.find({
      where: {
        donorOrganisationId: organisationId,
        status: In(TRANSFERRED_STATUSES),
        isDeleted: false,
      },
      select: ['amount'],
    });

    if (transfers.length === 0) {
      return '0.00';
    }

    const total = transfers.reduce(
      (sum, transfer) => sum + Number(transfer.amount),
      0,
    );
    return this.formatAmount(total);
  }

  private computeMetrics(
    rawBalance: string | null,
    committed: string,
    alreadyTransferred: string,
  ): {
    totalBalance: string;
    maxTransferable: string;
    availableSurplus: string;
  } {
    const totalBalance = this.formatAmount(Number(rawBalance ?? 0));
    const balance = Number(totalBalance);
    const committedAmount = Number(committed);
    const transferredAmount = Number(alreadyTransferred);
    const uncapped = Math.max(0, balance - committedAmount);
    const maxTransferable = this.formatAmount(
      Math.min(uncapped, balance * SURPLUS_CAP_RATIO),
    );
    const availableSurplus = this.formatAmount(
      Math.max(0, Number(maxTransferable) - transferredAmount),
    );

    return { totalBalance, maxTransferable, availableSurplus };
  }

  private toSummary(snapshot: LevySurplusSnapshot): LevySurplusSummary {
    return {
      organisationId: snapshot.organisationId,
      availableSurplus: snapshot.availableSurplus,
      computedAt: snapshot.computedAt,
    };
  }

  private formatAmount(value: number): string {
    return value.toFixed(2);
  }

  private utcDateOnly(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private formatDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
