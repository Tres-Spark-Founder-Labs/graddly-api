import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Organisation } from '../organisations/entities/organisation.entity.js';

import { DasHttpClient } from './das-http.client.js';
import { DasLevyMonthlyService } from './das-levy-monthly.service.js';
import { DasLevyBalanceResponseDto } from './dto/das-levy-balance-response.dto.js';
import { DasLevyBalance } from './entities/das-levy-balance.entity.js';
import { DasSyncStatus } from './enums/das-sync-status.enum.js';

@Injectable()
export class DasLevySyncService {
  constructor(
    private readonly client: DasHttpClient,
    private readonly monthlyService: DasLevyMonthlyService,
    @InjectRepository(DasLevyBalance)
    private readonly levyRepo: Repository<DasLevyBalance>,
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
  ) {}

  async syncOrganisation(
    organisationId: string,
    requestedByUserId?: string,
  ): Promise<DasLevyBalance> {
    const organisation = await this.organisationRepo.findOne({
      where: { id: organisationId, isDeleted: false },
    });
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    if (!organisation.ukprn) {
      throw new BadRequestException('Organisation has no UKPRN for DAS sync');
    }

    const record = await this.findOrCreate(organisationId, organisation.ukprn);

    try {
      const payload = await this.client.fetchLevyBalance(organisation.ukprn);
      record.ukprn = organisation.ukprn;
      record.accountId = payload.accountId;
      record.balance = payload.balance;
      record.currency = payload.currency;
      record.lastSyncedAt = new Date();
      record.lastSyncStatus = DasSyncStatus.SUCCESS;
      record.lastErrorMessage = null;
      record.rawPayload = {
        ...payload.raw,
        requestedByUserId: requestedByUserId ?? null,
      };
      record.utilisationSegments = this.monthlyService.buildUtilisationSegments(
        payload.raw,
        payload.balance,
        payload.currency ?? 'GBP',
      );
      await this.monthlyService.upsertFromRawPayload(
        organisationId,
        payload.raw,
        payload.currency ?? 'GBP',
      );
    } catch (error) {
      record.lastSyncStatus = DasSyncStatus.FAILED;
      record.lastErrorMessage = this.toMessage(error);
      throw error;
    } finally {
      await this.levyRepo.save(record);
    }

    return record;
  }

  async getLatestForOrganisation(
    organisationId: string,
  ): Promise<DasLevyBalanceResponseDto> {
    const record = await this.findOrCreate(organisationId);
    return {
      organisationId: record.organisationId,
      ukprn: record.ukprn,
      accountId: record.accountId,
      balance: record.balance,
      currency: record.currency,
      lastSyncStatus: record.lastSyncStatus,
      lastErrorMessage: record.lastErrorMessage,
      lastSyncedAt: record.lastSyncedAt?.toISOString() ?? null,
    };
  }

  private async findOrCreate(
    organisationId: string,
    ukprn?: string | null,
  ): Promise<DasLevyBalance> {
    const existing = await this.levyRepo.findOne({
      where: { organisationId, isDeleted: false },
    });
    if (existing) {
      return existing;
    }
    return this.levyRepo.create({
      organisationId,
      ukprn: ukprn ?? null,
      lastSyncStatus: DasSyncStatus.IDLE,
      lastSyncedAt: null,
      lastErrorMessage: null,
      accountId: null,
      balance: null,
      currency: null,
      rawPayload: null,
      utilisationSegments: null,
    });
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
