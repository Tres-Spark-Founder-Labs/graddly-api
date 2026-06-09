import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StorageService } from '../storage/storage.service.js';

import { CreateEvidencePackJobDto } from './dto/create-evidence-pack-job.dto.js';
import { EvidencePackJobResponseDto } from './dto/evidence-pack-job-response.dto.js';
import { EvidencePackJob } from './entities/evidence-pack-job.entity.js';
import { EvidencePackJobStatus } from './enums/evidence-pack-job-status.enum.js';
import { EvidencePackDispatchService } from './evidence-pack-dispatch.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class EvidencePackJobsService {
  constructor(
    private readonly dispatch: EvidencePackDispatchService,
    private readonly storage: StorageService,
    @InjectRepository(EvidencePackJob)
    private readonly jobRepo: Repository<EvidencePackJob>,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateEvidencePackJobDto,
  ): Promise<EvidencePackJobResponseDto> {
    const job = await this.dispatch.enqueue(user.organisationId!, user.id, dto);
    return this.toDto(job);
  }

  async findOne(
    user: AuthenticatedUser,
    jobId: string,
  ): Promise<EvidencePackJobResponseDto> {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, organisationId: user.organisationId! },
    });
    if (!job) throw new NotFoundException('Evidence pack job not found');
    return this.toDto(job, user.organisationId);
  }

  private async toDto(
    job: EvidencePackJob,
    organisationId?: string,
  ): Promise<EvidencePackJobResponseDto> {
    const dto: EvidencePackJobResponseDto = {
      jobId: job.id,
      status: job.status,
      outputKey: job.outputKey,
      errorMessage: job.errorMessage,
      manifest: job.manifest,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };

    if (
      organisationId &&
      job.status === EvidencePackJobStatus.COMPLETED &&
      job.outputKey
    ) {
      const download = await this.storage.createDownloadUrl(organisationId, {
        key: job.outputKey,
      });
      dto.downloadUrl = download.downloadUrl;
      dto.downloadExpiresAt = download.expiresAt.toISOString();
    }

    return dto;
  }
}
