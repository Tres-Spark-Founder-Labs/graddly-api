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
import { WithdrawalPushService } from '../withdrawal-push/withdrawal-push.service.js';

import { CreateApprenticeDto } from './dto/create-apprentice.dto.js';
import { UpdateApprenticeDto } from './dto/update-apprentice.dto.js';
import { Apprentice } from './entities/apprentice.entity.js';
import { ApprenticeStatus } from './enums/apprentice-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class ApprenticesService {
  constructor(
    @InjectRepository(Apprentice)
    private readonly apprenticeRepo: Repository<Apprentice>,
    private readonly withdrawalPushService: WithdrawalPushService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateApprenticeDto,
  ): Promise<Apprentice> {
    const organisationId = user.organisationId!;
    const email = dto.email.trim().toLowerCase();
    const existing = await this.apprenticeRepo.findOne({
      where: { organisationId, email },
    });
    if (existing && !existing.isDeleted) {
      throw new ConflictException('Apprentice with email already exists');
    }

    const apprentice = this.apprenticeRepo.create({
      organisationId,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      email,
      // Trimmed to null rather than stored as "": an empty payroll reference
      // is an absent one, and "" would defeat the partial index.
      employeeId: dto.employeeId?.trim() || null,
      status: dto.status,
    });

    return this.apprenticeRepo.save(apprentice);
  }

  async findAll(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Apprentice>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await this.apprenticeRepo.findAndCount({
      where: { organisationId: user.organisationId! },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return new PaginatedResult(
      items,
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<Apprentice> {
    const apprentice = await this.apprenticeRepo.findOne({
      where: { id, organisationId: user.organisationId! },
    });
    if (!apprentice) {
      throw new NotFoundException('Apprentice not found');
    }
    return apprentice;
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateApprenticeDto,
  ): Promise<Apprentice> {
    const apprentice = await this.findOne(user, id);
    const organisationId = user.organisationId!;

    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== apprentice.email) {
        const duplicate = await this.apprenticeRepo.findOne({
          where: { organisationId, email },
        });
        if (
          duplicate &&
          duplicate.id !== apprentice.id &&
          !duplicate.isDeleted
        ) {
          throw new ConflictException('Apprentice with email already exists');
        }
      }
      apprentice.email = email;
    }

    if (dto.firstName !== undefined)
      apprentice.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) apprentice.lastName = dto.lastName.trim();
    if (dto.employeeId !== undefined)
      apprentice.employeeId = dto.employeeId?.trim() || null;
    const wasWithdrawn = apprentice.status === ApprenticeStatus.WITHDRAWN;
    if (dto.status !== undefined) apprentice.status = dto.status;

    const updated = await this.apprenticeRepo.save(apprentice);
    if (!wasWithdrawn && updated.status === ApprenticeStatus.WITHDRAWN) {
      await this.withdrawalPushService.queueFromApprenticeWithdrawal({
        organisationId,
        apprenticeId: updated.id,
        requestedByUserId: user.id,
      });
    }

    return updated;
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const apprentice = await this.findOne(user, id);
    await this.apprenticeRepo.softRemove(apprentice);
  }
}
