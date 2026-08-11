import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LearnerScopeService } from '../common/learner-scope/learner-scope.service.js';
import { StorageService } from '../storage/storage.service.js';

import { CreatePdfJobDto } from './dto/create-pdf-job.dto.js';
import { PdfJobResponseDto } from './dto/pdf-job-response.dto.js';
import { PdfGenerationJob } from './entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from './enums/pdf-job-status.enum.js';
import { PdfDispatchService } from './pdf-dispatch.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class PdfJobsService {
  constructor(
    private readonly dispatch: PdfDispatchService,
    private readonly storage: StorageService,
    @InjectRepository(PdfGenerationJob)
    private readonly jobRepo: Repository<PdfGenerationJob>,
    private readonly learnerScope: LearnerScopeService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreatePdfJobDto,
  ): Promise<PdfJobResponseDto> {
    const organisationId = user.organisationId!;
    const job = await this.dispatch.enqueue({
      organisationId,
      userId: user.id,
      template: dto.template,
    });
    return this.toDto(job);
  }

  async findOne(
    user: AuthenticatedUser,
    jobId: string,
  ): Promise<PdfJobResponseDto> {
    const organisationId = user.organisationId!;

    /**
     * D3. A PDF job is org-scoped, and its `resultKey` presigns to a rendered
     * document — a cohort table or a learner profile. A learner polling job ids
     * would have been able to collect other learners' reports, so a learner is
     * narrowed to jobs they themselves requested.
     */
    const scope = await this.learnerScope.resolve(user);
    const job = await this.jobRepo.findOne({
      where: {
        id: jobId,
        organisationId,
        ...(scope.isLearner ? { requestedByUserId: user.id } : {}),
      },
    });
    if (!job) {
      throw new NotFoundException('PDF job not found');
    }
    return this.toDto(job, organisationId);
  }

  private async toDto(
    job: PdfGenerationJob,
    organisationId?: string,
  ): Promise<PdfJobResponseDto> {
    const dto: PdfJobResponseDto = {
      jobId: job.id,
      status: job.status,
      template: job.template,
      outputKey: job.outputKey,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };

    if (
      organisationId &&
      job.status === PdfJobStatus.COMPLETED &&
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
