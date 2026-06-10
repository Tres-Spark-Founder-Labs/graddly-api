import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import { IlrSubmission } from './entities/ilr-submission.entity.js';
import { IlrLearnerRecordStatus } from './enums/ilr-learner-record-status.enum.js';
import { IlrSubmissionStatus } from './enums/ilr-submission-status.enum.js';
import { IlrEnrolmentContext } from './ilr-enrolment.context.js';
import { IlrLearnerRecordStatusService } from './ilr-learner-record-status.service.js';
import { IlrLearnerRecordsService } from './ilr-learner-records.service.js';
import { IlrPayloadSerializerService } from './ilr-payload-serializer.service.js';
import { IlrSubmissionService } from './ilr-submission.service.js';
import { IlrSubmitDispatchService } from './ilr-submit-dispatch.service.js';
import {
  buildLearnerRecordFixture,
  buildSampleFieldMap,
} from './testing/ilr-test-fixtures.js';

describe('IlrSubmissionService', () => {
  let service: IlrSubmissionService;
  const submitDispatch = { enqueue: jest.fn() };
  const submissionRepo = {
    create: jest.fn((input: unknown) => input),
    save: jest.fn((input: IlrSubmission) =>
      Promise.resolve({
        ...input,
        id: input.id ?? 'sub-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
      }),
    ),
    findOne: jest.fn(),
    count: jest.fn(),
    find: jest.fn(),
  };

  const owner = {
    id: 'user-1',
    organisationId: 'org-1',
    roles: [OrganisationRole.OWNER],
  };

  const validatedRecord = buildLearnerRecordFixture({
    status: IlrLearnerRecordStatus.VALIDATED,
    fields: buildSampleFieldMap(),
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IlrSubmissionService,
        IlrLearnerRecordStatusService,
        IlrPayloadSerializerService,
        {
          provide: getRepositoryToken(IlrSubmission),
          useValue: submissionRepo,
        },
        {
          provide: IlrSubmitDispatchService,
          useValue: submitDispatch,
        },
        {
          provide: IlrLearnerRecordsService,
          useValue: {
            requireRecordEntity: jest.fn().mockResolvedValue(validatedRecord),
          },
        },
        {
          provide: IlrEnrolmentContext,
          useValue: {
            requireEnrolmentGraph: jest.fn().mockResolvedValue({
              organisation: { ukprn: '10012345' },
            }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(IlrSubmissionService);
    jest.clearAllMocks();
    submissionRepo.findOne.mockResolvedValue(null);
    submissionRepo.count.mockResolvedValue(0);
  });

  it('requires validated record before submit', async () => {
    const learnerRecords = {
      requireRecordEntity: jest
        .fn()
        .mockResolvedValue(
          buildLearnerRecordFixture({ status: IlrLearnerRecordStatus.DRAFT }),
        ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        IlrSubmissionService,
        IlrLearnerRecordStatusService,
        IlrPayloadSerializerService,
        {
          provide: getRepositoryToken(IlrSubmission),
          useValue: submissionRepo,
        },
        { provide: IlrSubmitDispatchService, useValue: submitDispatch },
        { provide: IlrLearnerRecordsService, useValue: learnerRecords },
        {
          provide: IlrEnrolmentContext,
          useValue: {
            requireEnrolmentGraph: jest.fn().mockResolvedValue({
              organisation: { ukprn: '10012345' },
            }),
          },
        },
      ],
    }).compile();
    const localService = moduleRef.get(IlrSubmissionService);

    await expect(
      localService.submit(owner as never, validatedRecord.id),
    ).rejects.toThrow(BadRequestException);
  });

  it('queues submit and returns queued status without calling ESFA inline', async () => {
    const result = await service.submit(owner as never, validatedRecord.id);
    expect(result.status).toBe(IlrSubmissionStatus.QUEUED);
    expect(result.attempt).toBe(1);
    expect(submitDispatch.enqueue).toHaveBeenCalledWith({
      submissionId: 'sub-1',
      organisationId: 'org-1',
      requestedByUserId: 'user-1',
    });
    expect(result.requestPayload).toMatchObject({ format: 'ilr-xml' });
  });

  it('blocks amend while in flight', async () => {
    submissionRepo.findOne.mockResolvedValueOnce({
      id: 'sub-queued',
      status: IlrSubmissionStatus.QUEUED,
    });

    await expect(
      service.amend(owner as never, validatedRecord.id),
    ).rejects.toThrow(ConflictException);
  });

  it('requires prior submitted record for amend', async () => {
    submissionRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      service.amend(owner as never, validatedRecord.id),
    ).rejects.toThrow(BadRequestException);
  });

  it('lists submissions for learner record', async () => {
    submissionRepo.find.mockResolvedValue([
      {
        id: 'sub-1',
        organisationId: 'org-1',
        ilrLearnerRecordId: validatedRecord.id,
        status: IlrSubmissionStatus.SUBMITTED,
        attempt: 1,
        isAmendment: false,
        amendsSubmissionId: null,
        esfaReference: 'ESFA-1',
        receipt: {},
        lastError: null,
        requestPayload: {},
        requestedByUserId: 'user-1',
        submittedAt: new Date(),
        failedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const rows = await service.listForRecord(
      owner as never,
      validatedRecord.id,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sub-1');
  });

  it('returns submission by id', async () => {
    submissionRepo.findOne.mockResolvedValue({
      id: 'sub-1',
      organisationId: 'org-1',
      ilrLearnerRecordId: validatedRecord.id,
      status: IlrSubmissionStatus.SUBMITTED,
      attempt: 1,
      isAmendment: false,
      amendsSubmissionId: null,
      esfaReference: 'ESFA-1',
      receipt: {},
      lastError: null,
      requestPayload: {},
      requestedByUserId: 'user-1',
      submittedAt: new Date(),
      failedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.findOne(owner as never, 'sub-1');

    expect(result.id).toBe('sub-1');
  });

  it('throws when submission not found', async () => {
    submissionRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne(owner as never, 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
