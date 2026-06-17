import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StorageService } from '../storage/storage.service.js';

import { CreateEpaPackJobDto } from './dto/create-epa-pack-job.dto.js';
import { EpaPackJobResponseDto } from './dto/epa-pack-job-response.dto.js';
import { EpaPackJob } from './entities/epa-pack-job.entity.js';
import { EpaPackJobStatus } from './enums/epa-pack-job-status.enum.js';
import { EpaPackDispatchService } from './epa-pack-dispatch.service.js';
import { PortfolioEnrolmentContext } from './portfolio-enrolment.context.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class EpaPackJobsService {
  constructor(
    private readonly dispatch: EpaPackDispatchService,
    private readonly storage: StorageService,
    private readonly enrolmentContext: PortfolioEnrolmentContext,
    @InjectRepository(EpaPackJob)
    private readonly jobRepo: Repository<EpaPackJob>,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateEpaPackJobDto,
  ): Promise<EpaPackJobResponseDto> {
    await this.enrolmentContext.requireEnrolmentForUser(user, dto.enrolmentId);
    const job = await this.dispatch.enqueue(user.organisationId!, user.id, dto);
    return this.toDto(job);
  }

  async findOne(
    user: AuthenticatedUser,
    jobId: string,
  ): Promise<EpaPackJobResponseDto> {
    const job = await this.jobRepo.findOne({
      where: { id: jobId, organisationId: user.organisationId! },
    });
    if (!job) {
      throw new NotFoundException('EPA pack job not found');
    }
    await this.enrolmentContext.requireEnrolmentForUser(user, job.enrolmentId);
    return this.toDto(job, user.organisationId);
  }

  private async toDto(
    job: EpaPackJob,
    organisationId?: string,
  ): Promise<EpaPackJobResponseDto> {
    const dto: EpaPackJobResponseDto = {
      jobId: job.id,
      enrolmentId: job.enrolmentId,
      status: job.status,
      outputKey: job.outputKey,
      errorMessage: job.errorMessage,
      manifest: job.manifest,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };

    if (
      organisationId &&
      job.status === EpaPackJobStatus.COMPLETED &&
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
