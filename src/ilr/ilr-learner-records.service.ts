import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';

import { BuildIlrLearnerRecordDto } from './dto/build-ilr-learner-record.dto.js';
import { IlrLearnerRecordResponseDto } from './dto/ilr-learner-record-response.dto.js';
import { IlrValidationReportResponseDto } from './dto/ilr-validation-report-response.dto.js';
import { ListIlrLearnerRecordsQueryDto } from './dto/list-ilr-learner-records-query.dto.js';
import { UpdateIlrLearnerRecordDto } from './dto/update-ilr-learner-record.dto.js';
import { IlrLearnerRecord } from './entities/ilr-learner-record.entity.js';
import { IlrLearnerRecordStatus } from './enums/ilr-learner-record-status.enum.js';
import { IlrEnrolmentContext } from './ilr-enrolment.context.js';
import { IlrLearnerRecordStatusService } from './ilr-learner-record-status.service.js';
import { IlrMappingConfigService } from './ilr-mapping-config.service.js';
import { IlrRowBuilderService } from './ilr-row-builder.service.js';
import { IlrValidationEngine } from './ilr-validation-engine.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
@Injectable()
export class IlrLearnerRecordsService {
  constructor(
    @InjectRepository(IlrLearnerRecord)
    private readonly repo: Repository<IlrLearnerRecord>,
    private readonly mappingConfigService: IlrMappingConfigService,
    private readonly enrolmentContext: IlrEnrolmentContext,
    private readonly rowBuilder: IlrRowBuilderService,
    private readonly validationEngine: IlrValidationEngine,
    private readonly statusService: IlrLearnerRecordStatusService,
  ) {}

  async build(
    user: AuthenticatedUser,
    dto: BuildIlrLearnerRecordDto,
  ): Promise<IlrLearnerRecordResponseDto> {
    const organisationId = user.organisationId!;
    this.assertCollectionPeriod(dto.collectionPeriod);

    const mappingConfig =
      await this.mappingConfigService.getActivePublishedEntity(
        dto.academicYear,
      );
    const graph = await this.enrolmentContext.requireEnrolmentGraph(
      organisationId,
      dto.enrolmentId,
    );

    let record = await this.repo.findOne({
      where: {
        organisationId,
        enrolmentId: dto.enrolmentId,
        collectionPeriod: dto.collectionPeriod,
        isDeleted: false,
      },
    });

    const manualOverrides = record?.manualOverrides ?? {};
    const fields = this.rowBuilder.buildFields(mappingConfig.config, {
      enrolment: graph.enrolment,
      apprentice: graph.apprentice,
      standard: graph.standard,
      organisation: graph.organisation,
      manualOverrides,
    });

    if (record) {
      record.fields = fields;
      record.mappingConfigId = mappingConfig.id;
      record.mappingConfigVersion = mappingConfig.version;
      record.academicYear = dto.academicYear;
      record.status = this.statusService.resetToDraft();
      record.lastValidatedAt = null;
      record.validationSummary = null;
    } else {
      record = this.repo.create({
        organisationId,
        enrolmentId: graph.enrolment.id,
        apprenticeId: graph.apprentice.id,
        collectionPeriod: dto.collectionPeriod,
        academicYear: dto.academicYear,
        mappingConfigId: mappingConfig.id,
        mappingConfigVersion: mappingConfig.version,
        fields,
        manualOverrides,
        status: IlrLearnerRecordStatus.DRAFT,
        lastValidatedAt: null,
        validationSummary: null,
      });
    }

    return this.toResponse(await this.repo.save(record));
  }

  async findAll(
    user: AuthenticatedUser,
    query: ListIlrLearnerRecordsQueryDto,
  ): Promise<PaginatedResult<IlrLearnerRecordResponseDto>> {
    const organisationId = user.organisationId!;
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const qb = this.repo
      .createQueryBuilder('record')
      .where('record.organisationId = :organisationId', { organisationId })
      .andWhere('record.isDeleted = false');

    if (query.enrolmentId) {
      qb.andWhere('record.enrolmentId = :enrolmentId', {
        enrolmentId: query.enrolmentId,
      });
    }
    if (query.collectionPeriod) {
      qb.andWhere('record.collectionPeriod = :collectionPeriod', {
        collectionPeriod: query.collectionPeriod,
      });
    }
    if (query.status) {
      qb.andWhere('record.status = :status', { status: query.status });
    }

    qb.orderBy('record.createdAt', 'DESC')
      .skip((page - 1) * perPage)
      .take(perPage);

    const [rows, total] = await qb.getManyAndCount();
    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<IlrLearnerRecordResponseDto> {
    const record = await this.requireRecord(user.organisationId!, id);
    return this.toResponse(record);
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateIlrLearnerRecordDto,
  ): Promise<IlrLearnerRecordResponseDto> {
    const organisationId = user.organisationId!;
    const record = await this.requireRecord(organisationId, id);

    const mappingConfig =
      await this.mappingConfigService.getActivePublishedEntity(
        record.academicYear,
      );
    const graph = await this.enrolmentContext.requireEnrolmentGraph(
      organisationId,
      record.enrolmentId,
    );

    record.manualOverrides = {
      ...record.manualOverrides,
      ...dto.manualOverrides,
    };
    record.fields = this.rowBuilder.buildFields(mappingConfig.config, {
      enrolment: graph.enrolment,
      apprentice: graph.apprentice,
      standard: graph.standard,
      organisation: graph.organisation,
      manualOverrides: record.manualOverrides,
    });
    record.status = this.statusService.resetToDraft();
    record.lastValidatedAt = null;
    record.validationSummary = null;

    return this.toResponse(await this.repo.save(record));
  }

  async validate(
    user: AuthenticatedUser,
    id: string,
  ): Promise<IlrLearnerRecordResponseDto> {
    const record = await this.requireRecord(user.organisationId!, id);
    const mappingConfig =
      await this.mappingConfigService.getActivePublishedEntity(
        record.academicYear,
      );

    const report = this.validationEngine.validate(
      mappingConfig.config,
      record.fields,
    );

    record.status = this.statusService.applyValidationResult(report.isValid);
    record.lastValidatedAt = new Date();
    record.validationSummary = report.summary;

    return this.toResponse(await this.repo.save(record));
  }

  async getValidationReport(
    user: AuthenticatedUser,
    id: string,
  ): Promise<IlrValidationReportResponseDto> {
    const record = await this.requireRecord(user.organisationId!, id);
    const mappingConfig =
      await this.mappingConfigService.getActivePublishedEntity(
        record.academicYear,
      );
    const report = this.validationEngine.validate(
      mappingConfig.config,
      record.fields,
    );
    return {
      issues: report.issues,
      summary: report.summary,
      isValid: report.isValid,
    };
  }

  async requireRecordEntity(
    organisationId: string,
    id: string,
  ): Promise<IlrLearnerRecord> {
    return this.requireRecord(organisationId, id);
  }

  private async requireRecord(
    organisationId: string,
    id: string,
  ): Promise<IlrLearnerRecord> {
    const record = await this.repo.findOne({
      where: { id, organisationId, isDeleted: false },
    });
    if (!record) {
      throw new NotFoundException('ILR learner record not found');
    }
    return record;
  }

  private assertCollectionPeriod(value: string): void {
    if (!/^\d{4}-\d{2}$/.test(value)) {
      throw new BadRequestException(
        'collectionPeriod must be in YYYY-MM format',
      );
    }
  }

  private toResponse(entity: IlrLearnerRecord): IlrLearnerRecordResponseDto {
    return {
      id: entity.id,
      organisationId: entity.organisationId,
      enrolmentId: entity.enrolmentId,
      apprenticeId: entity.apprenticeId,
      collectionPeriod: entity.collectionPeriod,
      academicYear: entity.academicYear,
      mappingConfigId: entity.mappingConfigId,
      mappingConfigVersion: entity.mappingConfigVersion,
      fields: entity.fields,
      manualOverrides: entity.manualOverrides,
      status: entity.status,
      lastValidatedAt: entity.lastValidatedAt?.toISOString() ?? null,
      validationSummary: entity.validationSummary,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
