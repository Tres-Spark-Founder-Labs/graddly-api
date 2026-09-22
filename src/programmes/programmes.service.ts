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

import { CreateProgrammeDto } from './dto/create-programme.dto.js';
import { UpdateProgrammeDto } from './dto/update-programme.dto.js';
import { Programme } from './entities/programme.entity.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class ProgrammesService {
  constructor(
    @InjectRepository(Programme)
    private readonly programmeRepo: Repository<Programme>,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateProgrammeDto,
  ): Promise<Programme> {
    const organisationId = user.organisationId!;
    const existing = await this.programmeRepo.findOne({
      where: { organisationId, code: dto.code.trim() },
    });
    if (existing && !existing.isDeleted) {
      throw new ConflictException('Programme code already exists');
    }

    const programme = this.programmeRepo.create({
      organisationId,
      code: dto.code.trim(),
      title: dto.title.trim(),
      description: dto.description?.trim() ?? null,
      status: dto.status,
    });
    return this.programmeRepo.save(programme);
  }

  async findAll(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Programme>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await this.programmeRepo.findAndCount({
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

  async findOne(user: AuthenticatedUser, id: string): Promise<Programme> {
    const programme = await this.programmeRepo.findOne({
      where: { id, organisationId: user.organisationId! },
    });
    if (!programme) {
      throw new NotFoundException('Programme not found');
    }
    return programme;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateProgrammeDto,
  ): Promise<Programme> {
    const programme = await this.findOne(user, id);
    const organisationId = user.organisationId!;

    if (dto.code !== undefined && dto.code.trim() !== programme.code) {
      const duplicate = await this.programmeRepo.findOne({
        where: { organisationId, code: dto.code.trim() },
      });
      if (duplicate && duplicate.id !== programme.id && !duplicate.isDeleted) {
        throw new ConflictException('Programme code already exists');
      }
      programme.code = dto.code.trim();
    }

    if (dto.title !== undefined) programme.title = dto.title.trim();
    if (dto.description !== undefined)
      programme.description = dto.description?.trim() ?? null;
    if (dto.status !== undefined) programme.status = dto.status;

    return this.programmeRepo.save(programme);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const programme = await this.findOne(user, id);
    await this.programmeRepo.softRemove(programme);
  }
}
