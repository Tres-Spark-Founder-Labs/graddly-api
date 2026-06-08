import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import { IlrSubmission } from './entities/ilr-submission.entity.js';
import { IlrLearnerRecordStatus } from './enums/ilr-learner-record-status.enum.js';
import { IlrSubmissionStatus } from './enums/ilr-submission-status.enum.js';
import { IlrEnrolmentContext } from './ilr-enrolment.context.js';
import { IlrLearnerRecordStatusService } from './ilr-learner-record-status.service.js';
import { IlrLearnerRecordsService } from './ilr-learner-records.service.js';
import { IlrPayloadSerializerService } from './ilr-payload-serializer.service.js';
import { IlrSubmissionService } from './ilr-submission.service.js';
import { ILR_ESFA_CLIENT } from './ilr.constants.js';
import {
  buildLearnerRecordFixture,
  buildSampleFieldMap,
} from './testing/ilr-test-fixtures.js';

describe('IlrSubmissionService', () => {
  let service: IlrSubmissionService;
  const esfaClient = { submit: jest.fn() };
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
          provide: ILR_ESFA_CLIENT,
          useValue: esfaClient,
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
        {
          provide: NotificationsService,
          useValue: { createForUser: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(IlrSubmissionService);
    jest.clearAllMocks();
    submissionRepo.findOne.mockResolvedValue(null);
    submissionRepo.count.mockResolvedValue(0);
    esfaClient.submit.mockResolvedValue({
      esfaReference: 'ESFA-1',
      receipt: { status: 'accepted' },
    });
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
        { provide: ILR_ESFA_CLIENT, useValue: esfaClient },
        { provide: IlrLearnerRecordsService, useValue: learnerRecords },
        {
          provide: IlrEnrolmentContext,
          useValue: {
            requireEnrolmentGraph: jest.fn().mockResolvedValue({
              organisation: { ukprn: '10012345' },
            }),
          },
        },
        {
          provide: NotificationsService,
          useValue: { createForUser: jest.fn() },
        },
      ],
    }).compile();
    const localService = moduleRef.get(IlrSubmissionService);

    await expect(
      localService.submit(owner as never, validatedRecord.id),
    ).rejects.toThrow(BadRequestException);
  });

  it('stores receipt on successful submit', async () => {
    const result = await service.submit(owner as never, validatedRecord.id);
    expect(result.status).toBe(IlrSubmissionStatus.SUBMITTED);
    expect(result.esfaReference).toBe('ESFA-1');
    expect(result.attempt).toBe(1);
  });

  it('blocks amend while processing', async () => {
    submissionRepo.findOne.mockImplementation(
      (options: { where?: { status?: IlrSubmissionStatus } }) => {
        if (options.where?.status === IlrSubmissionStatus.PROCESSING) {
          return Promise.resolve({
            id: 'sub-processing',
            status: IlrSubmissionStatus.PROCESSING,
          });
        }
        return Promise.resolve(null);
      },
    );

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

  it('records failure and rethrows when ESFA client fails', async () => {
    esfaClient.submit.mockRejectedValue(
      new InternalServerErrorException('submit failed'),
    );

    await expect(
      service.submit(owner as never, validatedRecord.id),
    ).rejects.toThrow(InternalServerErrorException);
    expect(submissionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: IlrSubmissionStatus.FAILED,
        lastError: expect.stringMatching(/submit failed/) as string,
      }),
    );
  });
});
