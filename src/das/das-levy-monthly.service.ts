import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  parseLevyMonthlyEntries,
  parseUtilisationSegments,
} from './das-levy-history.parser.js';
import { DasLevyMonthlyEntry } from './entities/das-levy-monthly-entry.entity.js';

import type { IDasUtilisationSegments } from './types/das-utilisation-segments.types.js';

@Injectable()
export class DasLevyMonthlyService {
  constructor(
    @InjectRepository(DasLevyMonthlyEntry)
    private readonly monthlyRepo: Repository<DasLevyMonthlyEntry>,
  ) {}

  async upsertFromRawPayload(
    organisationId: string,
    raw: Record<string, unknown>,
    currency: string,
  ): Promise<void> {
    const parsed = parseLevyMonthlyEntries(raw);
    if (parsed.length === 0) {
      return;
    }

    const recent = parsed.slice(-12);
    for (const entry of recent) {
      const monthDate = `${entry.month}-01`;
      const existing = await this.monthlyRepo.findOne({
        where: {
          organisationId,
          month: monthDate,
          isDeleted: false,
        },
      });

      if (existing) {
        existing.contributions = String(entry.contributions);
        existing.spend = String(entry.spend);
        existing.currency = currency;
        await this.monthlyRepo.save(existing);
      } else {
        await this.monthlyRepo.save(
          this.monthlyRepo.create({
            organisationId,
            month: monthDate,
            contributions: String(entry.contributions),
            spend: String(entry.spend),
            currency,
          }),
        );
      }
    }
  }

  buildUtilisationSegments(
    raw: Record<string, unknown>,
    balance: string | null,
    currency: string,
  ): IDasUtilisationSegments {
    return parseUtilisationSegments(raw, balance, currency);
  }

  async listLast12Months(
    organisationId: string,
  ): Promise<DasLevyMonthlyEntry[]> {
    return this.monthlyRepo.find({
      where: { organisationId, isDeleted: false },
      order: { month: 'DESC' },
      take: 12,
    });
  }

  toMonthlyContributionDtos(entries: DasLevyMonthlyEntry[]): Array<{
    month: string;
    amount: number;
    spend: number;
  }> {
    return [...entries]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((entry) => ({
        month: entry.month.slice(0, 7),
        amount: Number(entry.contributions),
        spend: Number(entry.spend),
      }));
  }
}
