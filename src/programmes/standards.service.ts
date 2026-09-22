import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

import { CreateStandardDto } from './dto/create-standard.dto.js';
import { UpdateStandardDto } from './dto/update-standard.dto.js';
import { Programme } from './entities/programme.entity.js';
import { Standard } from './entities/standard.entity.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class StandardsService {
  constructor(
    @InjectRepository(Standard)
    private readonly standardRepo: Repository<Standard>,
    @InjectRepository(Programme)
    private readonly programmeRepo: Repository<Programme>,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateStandardDto,
  ): Promise<Standard> {
    const organisationId = user.organisationId!;
    await this.ensureProgrammeInOrg(organisationId, dto.programmeId);

    const existing = await this.standardRepo.findOne({
      where: { organisationId, code: dto.code.trim() },
    });
    if (existing && !existing.isDeleted) {
      throw new ConflictException('Standard code already exists');
    }

    const standard = this.standardRepo.create({
      organisationId,
      programmeId: dto.programmeId,
      code: dto.code.trim(),
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      status: dto.status,
      fundingBandMax:
        dto.fundingBandMax !== undefined ? String(dto.fundingBandMax) : null,
      defaultDurationMonths: dto.defaultDurationMonths ?? null,
    });

    return this.standardRepo.save(standard);
  }

  async findAll(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Standard>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await this.standardRepo.findAndCount({
      where: { organisationId: user.organisationId! },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return new PaginatedResult(
      items,
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<Standard> {
    const standard = await this.standardRepo.findOne({
      where: { id, organisationId: user.organisationId! },
    });
    if (!standard) {
      throw new NotFoundException('Standard not found');
    }
    return standard;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateStandardDto,
  ): Promise<Standard> {
    const standard = await this.findOne(user, id);
    const organisationId = user.organisationId!;

    if (dto.programmeId !== undefined) {
      await this.ensureProgrammeInOrg(organisationId, dto.programmeId);
      standard.programmeId = dto.programmeId;
    }

    if (dto.code !== undefined && dto.code.trim() !== standard.code) {
      const duplicate = await this.standardRepo.findOne({
        where: { organisationId, code: dto.code.trim() },
      });
      if (duplicate && duplicate.id !== standard.id && !duplicate.isDeleted) {
        throw new ConflictException('Standard code already exists');
      }
      standard.code = dto.code.trim();
    }

    if (dto.title !== undefined) standard.title = dto.title.trim();
    if (dto.description !== undefined)
      standard.description = dto.description?.trim() ?? null;
    if (dto.status !== undefined) standard.status = dto.status;
    if (dto.fundingBandMax !== undefined) {
      standard.fundingBandMax = String(dto.fundingBandMax);
    }
    if (dto.defaultDurationMonths !== undefined) {
      standard.defaultDurationMonths = dto.defaultDurationMonths;
    }

    return this.standardRepo.save(standard);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const standard = await this.findOne(user, id);
    await this.standardRepo.softRemove(standard);
  }

  private async ensureProgrammeInOrg(
    organisationId: string,
    programmeId: string,
  ): Promise<void> {
    const programme = await this.programmeRepo.findOne({
      where: { id: programmeId, organisationId },
    });
    if (!programme) {
      throw new NotFoundException('Programme not found');
    }
  }
}
