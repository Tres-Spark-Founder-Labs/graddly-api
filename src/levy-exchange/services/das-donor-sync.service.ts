import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DasLevyTranche } from '../entities/das-levy-tranche.entity.js';

export interface IParsedLevyTranche {
  amount: string;
  expiresOn: string;
  rawPayload: Record<string, unknown>;
}

@Injectable()
export class DasDonorSyncService {
  constructor(
    @InjectRepository(DasLevyTranche)
    private readonly trancheRepo: Repository<DasLevyTranche>,
  ) {}

  parseTranches(rawPayload: Record<string, unknown>): IParsedLevyTranche[] {
    const candidates = [
      rawPayload.tranches,
      rawPayload.expiryTranches,
      rawPayload.levyTranches,
    ];

    const parsed: IParsedLevyTranche[] = [];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }
      for (const item of candidate) {
        const tranche = this.parseTrancheItem(item);
        if (tranche) {
          parsed.push(tranche);
        }
      }
    }

    return parsed;
  }

  async replaceTranches(
    donorLinkId: string,
    organisationId: string,
    rawPayload: Record<string, unknown>,
  ): Promise<DasLevyTranche[]> {
    const parsed = this.parseTranches(rawPayload);

    await this.trancheRepo.delete({ donorLinkId, organisationId });

    if (parsed.length === 0) {
      return [];
    }

    const rows = parsed.map((tranche) =>
      this.trancheRepo.create({
        donorLinkId,
        organisationId,
        amount: tranche.amount,
        expiresOn: tranche.expiresOn,
        rawPayload: tranche.rawPayload,
      }),
    );

    return this.trancheRepo.save(rows);
  }

  private parseTrancheItem(item: unknown): IParsedLevyTranche | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const raw = item as Record<string, unknown>;
    const amount = this.pickNumericString(raw, [
      'amount',
      'balance',
      'levyAmount',
      'value',
    ]);
    const expiresOn = this.pickDateString(raw, [
      'expiresOn',
      'expiryDate',
      'expiresAt',
      'expiry',
    ]);

    if (!amount || !expiresOn) {
      return null;
    }

    return {
      amount,
      expiresOn,
      rawPayload: raw,
    };
  }

  private pickNumericString(
    raw: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toFixed(2);
      }
      if (typeof value === 'string' && value.trim()) {
        const asNumber = Number(value);
        if (Number.isFinite(asNumber)) {
          return asNumber.toFixed(2);
        }
      }
    }
    return null;
  }

  private pickDateString(
    raw: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value !== 'string' || !value.trim()) {
        continue;
      }
      const datePart = value.trim().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        return datePart;
      }
    }
    return null;
  }
}
