import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

/* eslint-disable @typescript-eslint/naming-convention -- ILR manual override keys */
import { EnrolmentPushService } from '../enrolment-push/enrolment-push.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';

import { IlrLearnerRecord } from './entities/ilr-learner-record.entity.js';
import { IlrLearnerRecordStatus } from './enums/ilr-learner-record-status.enum.js';
import { IlrEnrolmentContext } from './ilr-enrolment.context.js';
import { IlrLearnerRecordStatusService } from './ilr-learner-record-status.service.js';
import { IlrLearnerRecordsService } from './ilr-learner-records.service.js';
import { IlrMappingConfigService } from './ilr-mapping-config.service.js';
import { IlrRowBuilderService } from './ilr-row-builder.service.js';
import { IlrValidationEngine } from './ilr-validation-engine.service.js';
import {
  buildEnrolmentGraphFixture,
  buildLearnerRecordFixture,
  minimalMappingConfig,
} from './testing/ilr-test-fixtures.js';

describe('IlrLearnerRecordsService', () => {
  let service: IlrLearnerRecordsService;
  const enrolmentPush = { queueFromIlrRecord: jest.fn() };
  const repo = {
    findOne: jest.fn(),
    create: jest.fn((input: unknown) => input),
    save: jest.fn((input: IlrLearnerRecord) =>
      Promise.resolve({
        ...input,
        id: input.id ?? 'record-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
      }),
    ),
    createQueryBuilder: jest.fn(),
  };

  const user = { id: 'user-1', organisationId: 'org-1', roles: ['owner'] };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IlrLearnerRecordsService,
        IlrRowBuilderService,
        IlrValidationEngine,
        IlrLearnerRecordStatusService,
        { provide: getRepositoryToken(IlrLearnerRecord), useValue: repo },
        {
          provide: IlrMappingConfigService,
          useValue: {
            getActivePublishedEntity: jest.fn().mockResolvedValue({
              id: 'cfg-1',
              version: 1,
              config: minimalMappingConfig,
            }),
          },
        },
        {
          provide: IlrEnrolmentContext,
          useValue: {
            requireEnrolmentGraph: jest
              .fn()
              .mockResolvedValue(buildEnrolmentGraphFixture()),
          },
        },
        {
          provide: EifScoreCacheService,
          useValue: { invalidate: jest.fn() },
        },
        { provide: EnrolmentPushService, useValue: enrolmentPush },
      ],
    }).compile();

    service = moduleRef.get(IlrLearnerRecordsService);
    jest.clearAllMocks();
    repo.findOne.mockResolvedValue(null);
  });

  it('builds a new learner record for collection period', async () => {
    const result = await service.build(user as never, {
      enrolmentId: '11111111-1111-1111-1111-111111111111',
      collectionPeriod: '2025-10',
      academicYear: '2025-26',
    });

    expect(result.status).toBe(IlrLearnerRecordStatus.DRAFT);
    expect(result.fields.Provider.UKPRN).toBe('10012345');
    expect(repo.save).toHaveBeenCalled();
    expect(enrolmentPush.queueFromIlrRecord).toHaveBeenCalled();
  });

  it('rebuilds existing record idempotently for same period', async () => {
    repo.findOne.mockResolvedValue(
      buildLearnerRecordFixture({
        manualOverrides: { 'Learner.ULN': '1111111111' },
      }),
    );

    const result = await service.build(user as never, {
      enrolmentId: '11111111-1111-1111-1111-111111111111',
      collectionPeriod: '2025-10',
      academicYear: '2025-26',
    });

    expect(result.manualOverrides['Learner.ULN']).toBe('1111111111');
    expect(result.status).toBe(IlrLearnerRecordStatus.DRAFT);
    expect(enrolmentPush.queueFromIlrRecord).not.toHaveBeenCalled();
  });

  it('patch resets status to draft', async () => {
    repo.findOne.mockResolvedValue(
      buildLearnerRecordFixture({
        status: IlrLearnerRecordStatus.VALIDATED,
      }),
    );

    const result = await service.update(user as never, 'record-1', {
      manualOverrides: { 'Learner.ULN': '2222222222' },
    });

    expect(result.status).toBe(IlrLearnerRecordStatus.DRAFT);
    expect(result.manualOverrides['Learner.ULN']).toBe('2222222222');
  });

  it('returns paginated learner records', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest
        .fn()
        .mockResolvedValue([[buildLearnerRecordFixture()], 1]),
    };
    repo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.findAll(user as never, {
      page: 1,
      perPage: 10,
    });

    expect(result.items).toHaveLength(1);
  });

  it('returns learner record by id', async () => {
    const record = {
      ...buildLearnerRecordFixture({ id: 'record-1' }),
      organisationId: 'org-1',
    };
    repo.findOne.mockResolvedValue(record);

    const result = await service.findOne(user as never, 'record-1');

    expect(result.id).toBe('record-1');
  });

  it('validates learner record and updates status', async () => {
    repo.findOne.mockResolvedValue({
      ...buildLearnerRecordFixture({ id: 'record-1' }),
      organisationId: 'org-1',
    });

    const result = await service.validate(user as never, 'record-1');

    expect(result.status).toBe(IlrLearnerRecordStatus.VALIDATED);
    expect(repo.save).toHaveBeenCalled();
  });

  it('returns validation report without persisting', async () => {
    repo.findOne.mockResolvedValue({
      ...buildLearnerRecordFixture({ id: 'record-1' }),
      organisationId: 'org-1',
    });

    const report = await service.getValidationReport(user as never, 'record-1');

    expect(report).toHaveProperty('isValid');
    expect(report).toHaveProperty('issues');
  });

  it('requires record entity for organisation', async () => {
    const record = {
      ...buildLearnerRecordFixture({ id: 'record-1' }),
      organisationId: 'org-1',
    };
    repo.findOne.mockResolvedValue(record);

    await expect(
      service.requireRecordEntity('org-1', 'record-1'),
    ).resolves.toEqual(record);
  });
});
