/**
 * Platform-wide ILR mapping configs (not tenant-scoped).
 * GROWTH: per-funding-stream variants, draft diff preview before publish.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import { CreateIlrMappingConfigDto } from './dto/create-ilr-mapping-config.dto.js';
import { IlrMappingConfigResponseDto } from './dto/ilr-mapping-config-response.dto.js';
import { IlrMappingConfig } from './entities/ilr-mapping-config.entity.js';
import { IlrMappingConfigStatus } from './enums/ilr-mapping-config-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class IlrMappingConfigService {
  constructor(
    @InjectRepository(IlrMappingConfig)
    private readonly repo: Repository<IlrMappingConfig>,
    private readonly config: ConfigService,
  ) {}

  async findAll(): Promise<IlrMappingConfigResponseDto[]> {
    const rows = await this.repo.find({
      where: { isDeleted: false },
      order: { academicYear: 'DESC', version: 'DESC' },
    });
    return rows.map((row) => this.toResponse(row));
  }

  async findActivePublished(
    academicYear: string,
  ): Promise<IlrMappingConfigResponseDto> {
    const row = await this.repo.findOne({
      where: {
        academicYear,
        status: IlrMappingConfigStatus.PUBLISHED,
        isDeleted: false,
      },
    });
    if (!row) {
      throw new NotFoundException(
        `No published ILR mapping config for academic year ${academicYear}`,
      );
    }
    return this.toResponse(row);
  }

  async getActivePublishedEntity(
    academicYear: string,
  ): Promise<IlrMappingConfig> {
    const row = await this.repo.findOne({
      where: {
        academicYear,
        status: IlrMappingConfigStatus.PUBLISHED,
        isDeleted: false,
      },
    });
    if (!row) {
      throw new NotFoundException(
        `No published ILR mapping config for academic year ${academicYear}`,
      );
    }
    return row;
  }

  async createDraft(
    user: AuthenticatedUser,
    dto: CreateIlrMappingConfigDto,
  ): Promise<IlrMappingConfigResponseDto> {
    this.assertConfigWriteAllowed(user);
    const latest = await this.repo.findOne({
      where: { academicYear: dto.academicYear, isDeleted: false },
      order: { version: 'DESC' },
    });
    const version = (latest?.version ?? 0) + 1;
    const entity = this.repo.create({
      academicYear: dto.academicYear,
      version,
      status: IlrMappingConfigStatus.DRAFT,
      config: dto.config,
      publishedAt: null,
    });
    return this.toResponse(await this.repo.save(entity));
  }

  async publish(
    user: AuthenticatedUser,
    id: string,
  ): Promise<IlrMappingConfigResponseDto> {
    this.assertConfigWriteAllowed(user);
    const entity = await this.repo.findOne({
      where: { id, isDeleted: false },
    });
    if (!entity) {
      throw new NotFoundException('ILR mapping config not found');
    }
    if (entity.status !== IlrMappingConfigStatus.DRAFT) {
      throw new BadRequestException(
        'Only draft mapping configs can be published',
      );
    }

    const existingPublished = await this.repo.findOne({
      where: {
        academicYear: entity.academicYear,
        status: IlrMappingConfigStatus.PUBLISHED,
        isDeleted: false,
      },
    });
    if (existingPublished) {
      existingPublished.status = IlrMappingConfigStatus.SUPERSEDED;
      await this.repo.save(existingPublished);
    }

    entity.status = IlrMappingConfigStatus.PUBLISHED;
    entity.publishedAt = new Date();
    return this.toResponse(await this.repo.save(entity));
  }

  private assertConfigWriteAllowed(user: AuthenticatedUser): void {
    const enabled = this.config.get<boolean>(
      'app.ilr.configWriteEnabled',
      false,
    );
    if (!enabled) {
      throw new BadRequestException('ILR mapping config write is disabled');
    }
    const roles = user.roles ?? [];
    if (
      !roles.includes(OrganisationRole.OWNER) &&
      !roles.includes(OrganisationRole.ADMIN)
    ) {
      throw new BadRequestException(
        'Only organisation owners or admins can manage ILR mapping configs',
      );
    }
  }

  private toResponse(entity: IlrMappingConfig): IlrMappingConfigResponseDto {
    return {
      id: entity.id,
      academicYear: entity.academicYear,
      version: entity.version,
      status: entity.status,
      config: entity.config,
      publishedAt: entity.publishedAt?.toISOString() ?? null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
