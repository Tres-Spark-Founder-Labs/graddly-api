import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DAS_CLIENT } from '../../das/das-client.constants.js';
import { CreateDonorLinkDto } from '../dto/create-donor-link.dto.js';
import { DonorLinkResponseDto } from '../dto/donor-link-response.dto.js';
import { DasDonorLink } from '../entities/das-donor-link.entity.js';
import { DasDonorOAuthToken } from '../entities/das-donor-oauth-token.entity.js';
import { DasDonorLinkStatus } from '../enums/das-donor-link-status.enum.js';

import { DasDonorOAuthService } from './das-donor-oauth.service.js';
import { DasDonorSyncService } from './das-donor-sync.service.js';

import type { IDasClient } from '../../das/interfaces/das.client.interface.js';

@Injectable()
export class DasDonorLinkService {
  constructor(
    @Inject(DAS_CLIENT)
    private readonly dasHttpClient: IDasClient,
    private readonly donorOAuth: DasDonorOAuthService,
    private readonly donorSync: DasDonorSyncService,
    @InjectRepository(DasDonorLink)
    private readonly linkRepo: Repository<DasDonorLink>,
    @InjectRepository(DasDonorOAuthToken)
    private readonly tokenRepo: Repository<DasDonorOAuthToken>,
  ) {}

  async create(
    organisationId: string,
    dto: CreateDonorLinkDto,
  ): Promise<DonorLinkResponseDto> {
    const link = this.linkRepo.create({
      organisationId,
      label: dto.label?.trim() || null,
      ukprn: dto.ukprn?.trim() || null,
      status: DasDonorLinkStatus.PENDING_CONSENT,
      lastErrorMessage: null,
      consentedAt: null,
      lastSyncedAt: null,
      dasAccountId: null,
      lastBalance: null,
      lastRawPayload: null,
    });
    const saved = await this.linkRepo.save(link);
    return this.toResponse(saved);
  }

  async findAll(organisationId: string): Promise<DonorLinkResponseDto[]> {
    const links = await this.linkRepo.find({
      where: { organisationId, isDeleted: false },
      order: { createdAt: 'DESC' },
    });
    return links.map((link) => this.toResponse(link));
  }

  async findOne(
    organisationId: string,
    linkId: string,
  ): Promise<DonorLinkResponseDto> {
    const link = await this.getLinkOrThrow(organisationId, linkId);
    return this.toResponse(link);
  }

  async remove(organisationId: string, linkId: string): Promise<void> {
    const link = await this.getLinkOrThrow(organisationId, linkId);
    const token = await this.tokenRepo.findOne({
      where: { donorLinkId: link.id, isDeleted: false },
    });
    if (token) {
      await this.tokenRepo.softRemove(token);
    }
    await this.linkRepo.softRemove(link);
  }

  async startConsent(
    organisationId: string,
    userId: string,
    linkId: string,
  ): Promise<{ authorizeUrl: string }> {
    if (!this.donorOAuth.isConfigured()) {
      throw new ServiceUnavailableException(
        'Donor DAS OAuth is not configured',
      );
    }

    const link = await this.getLinkOrThrow(organisationId, linkId);
    if (link.status === DasDonorLinkStatus.LINKED) {
      throw new BadRequestException('Donor link is already connected');
    }

    return {
      authorizeUrl: this.donorOAuth.buildAuthorizeUrl(
        link.id,
        organisationId,
        userId,
      ),
    };
  }

  async completeOAuthCallback(
    code: string,
    state: string,
  ): Promise<DonorLinkResponseDto> {
    const statePayload = this.donorOAuth.verifyState(state);
    const link = await this.linkRepo.findOne({
      where: {
        id: statePayload.linkId,
        organisationId: statePayload.orgId,
        isDeleted: false,
      },
    });
    if (!link) {
      throw new NotFoundException('Donor link not found');
    }

    try {
      const tokenPayload = await this.donorOAuth.exchangeCode(code);
      await this.upsertToken(link, tokenPayload);
      link.status = DasDonorLinkStatus.LINKED;
      link.consentedAt = new Date();
      link.lastErrorMessage = null;
      const saved = await this.linkRepo.save(link);
      return this.toResponse(saved);
    } catch (error) {
      link.status = DasDonorLinkStatus.ERROR;
      link.lastErrorMessage = this.toMessage(error);
      await this.linkRepo.save(link);
      throw error;
    }
  }

  async syncDonorLink(
    organisationId: string,
    linkId: string,
  ): Promise<DonorLinkResponseDto> {
    const link = await this.getLinkOrThrow(organisationId, linkId);
    if (link.status !== DasDonorLinkStatus.LINKED) {
      throw new BadRequestException('Donor link is not connected');
    }
    if (!link.ukprn) {
      throw new BadRequestException('Donor link has no UKPRN for DAS sync');
    }

    const token = await this.tokenRepo.findOne({
      where: { donorLinkId: link.id, isDeleted: false },
    });
    if (!token) {
      throw new BadRequestException('Donor OAuth token not found');
    }

    try {
      const tokenPayload = await this.donorOAuth.refreshToken(token);
      await this.upsertToken(link, tokenPayload);

      const payload = await this.dasHttpClient.fetchLevyBalance(
        link.ukprn,
        tokenPayload.accessToken,
      );

      link.dasAccountId = payload.accountId;
      link.lastBalance = payload.balance;
      link.lastSyncedAt = new Date();
      link.lastErrorMessage = null;
      link.lastRawPayload = payload.raw;
      link.status = DasDonorLinkStatus.LINKED;

      const saved = await this.linkRepo.save(link);
      await this.donorSync.replaceTranches(
        saved.id,
        organisationId,
        payload.raw,
      );
      return this.toResponse(saved);
    } catch (error) {
      link.status = DasDonorLinkStatus.ERROR;
      link.lastErrorMessage = this.toMessage(error);
      await this.linkRepo.save(link);
      throw error;
    }
  }

  private async upsertToken(
    link: DasDonorLink,
    tokenPayload: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date;
      scope: string | null;
    },
  ): Promise<DasDonorOAuthToken> {
    const encrypted = this.donorOAuth.encryptTokenPayload(tokenPayload);
    const existing = await this.tokenRepo.findOne({
      where: { donorLinkId: link.id, isDeleted: false },
    });

    if (existing) {
      existing.accessTokenEncrypted = encrypted.accessTokenEncrypted;
      existing.refreshTokenEncrypted = encrypted.refreshTokenEncrypted;
      existing.expiresAt = encrypted.expiresAt;
      existing.scope = encrypted.scope;
      return this.tokenRepo.save(existing);
    }

    const created = this.tokenRepo.create({
      organisationId: link.organisationId,
      donorLinkId: link.id,
      ...encrypted,
    });
    return this.tokenRepo.save(created);
  }

  private async getLinkOrThrow(
    organisationId: string,
    linkId: string,
  ): Promise<DasDonorLink> {
    const link = await this.linkRepo.findOne({
      where: { id: linkId, organisationId, isDeleted: false },
    });
    if (!link) {
      throw new NotFoundException('Donor link not found');
    }
    return link;
  }

  private toResponse(link: DasDonorLink): DonorLinkResponseDto {
    return {
      id: link.id,
      organisationId: link.organisationId,
      label: link.label,
      dasAccountId: link.dasAccountId,
      ukprn: link.ukprn,
      status: link.status,
      lastErrorMessage: link.lastErrorMessage,
      consentedAt: link.consentedAt?.toISOString() ?? null,
      lastSyncedAt: link.lastSyncedAt?.toISOString() ?? null,
      lastBalance: link.lastBalance,
      createdAt: link.createdAt.toISOString(),
      updatedAt: link.updatedAt.toISOString(),
    };
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
