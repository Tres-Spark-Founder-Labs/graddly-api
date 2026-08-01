import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditEventService } from '../audit/audit-event.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';

import { CommitmentStatementStatusService } from './commitment-statement-status.service.js';
import { CommitmentStatementsService } from './commitment-statements.service.js';
import { CommitmentStatementGroup } from './entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from './enums/commitment-statement-status.enum.js';

describe('CommitmentStatementsService', () => {
  const groupQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const groupRepo = {
    createQueryBuilder: jest.fn(() => groupQueryBuilder),
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: { id?: string }) => ({ id: 'group-1', ...v })),
  };
  const statementQueryBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };
  const statementRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => statementQueryBuilder),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: { id?: string; version?: number }) => ({
      id: v.id ?? `stmt-${v.version ?? 1}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      publishedAt: null,
      publishedByUserId: null,
      supersededAt: null,
      snapshotPdfJobId: null,
      finalSignedPdfKey: null,
      status: CommitmentStatementStatus.DRAFT,
      organisationId: 'org-1',
      groupId: 'group-1',
      ...v,
    })),
  };
  const enrolmentRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: 'enr-1',
      apprenticeId: 'app-1',
    }),
  };
  const pdfDispatch = { enqueue: jest.fn() };
  /**
   * F1.3.3 AC1 — views and version changes are recorded explicitly, because a
   * TypeORM subscriber never sees a read and sees a version bump only as two
   * unrelated row writes.
   */
  const auditEvents = {
    recordView: jest.fn(),
    recordSignature: jest.fn(),
    recordVersionChange: jest.fn(),
  };

  let service: CommitmentStatementsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommitmentStatementsService,
        CommitmentStatementStatusService,
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: groupRepo,
        },
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: statementRepo,
        },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: PdfDispatchService, useValue: pdfDispatch },
        { provide: AuditEventService, useValue: auditEvents },
      ],
    }).compile();

    service = moduleRef.get(CommitmentStatementsService);
    jest.clearAllMocks();
    groupRepo.findOne.mockResolvedValue(null);
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'enr-1',
      apprenticeId: 'app-1',
    });
  });

  const user = {
    id: 'user-1',
    organisationId: 'org-1',
    email: 'o@example.com',
    roles: ['owner'],
  } as const;

  const content = {
    trainingPlanSummary: 'Plan',
    employerCommitments: 'Employer',
    apprenticeCommitments: 'Apprentice',
    providerCommitments: 'Provider',
  };

  it('creates group and version 1', async () => {
    const result = await service.create(user, {
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
      content,
      apprenticeUserId: 'u1',
      tutorUserId: 'u2',
      employerManagerUserId: 'u3',
    });
    expect(result.version).toBe(1);
    expect(result.status).toBe(CommitmentStatementStatus.DRAFT);
    expect(groupRepo.save).toHaveBeenCalled();
  });

  it('rejects duplicate group per enrolment', async () => {
    groupRepo.findOne.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create(user, {
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        content,
        apprenticeUserId: 'u1',
        tutorUserId: 'u2',
        employerManagerUserId: 'u3',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects version bump while draft', async () => {
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
      currentVersionId: 'stmt-1',
      isDeleted: false,
    });
    statementRepo.findOne.mockResolvedValue({
      id: 'stmt-1',
      version: 1,
      status: CommitmentStatementStatus.DRAFT,
      groupId: 'group-1',
      organisationId: 'org-1',
    });

    await expect(
      service.createVersion(user, 'group-1', {
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
        content,
        apprenticeUserId: 'u1',
        tutorUserId: 'u2',
        employerManagerUserId: 'u3',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns paginated statements', async () => {
    const row = {
      id: 'stmt-1',
      groupId: 'group-1',
      organisationId: 'org-1',
      version: 1,
      status: CommitmentStatementStatus.DRAFT,
      content,
      apprenticeUserId: 'u1',
      tutorUserId: 'u2',
      employerManagerUserId: 'u3',
      createdAt: new Date(),
      updatedAt: new Date(),
      group: {
        enrolmentId: 'enr-1',
        apprenticeId: 'app-1',
      },
    };
    statementQueryBuilder.getManyAndCount.mockResolvedValue([[row], 1]);
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
    });

    const result = await service.findAll(user, { page: 1, perPage: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].version).toBe(1);
  });

  it('returns statement by id', async () => {
    statementRepo.findOne.mockResolvedValue({
      id: 'stmt-1',
      groupId: 'group-1',
      organisationId: 'org-1',
      version: 1,
      status: CommitmentStatementStatus.DRAFT,
      content,
      apprenticeUserId: 'u1',
      tutorUserId: 'u2',
      employerManagerUserId: 'u3',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
    });

    /**
     * F1.3.2 AC1 — `findOne` resolves the statement for any *party*, not only
     * the organisation that owns it, so it goes through a query builder that
     * joins the enrolment. Statements are drafted by the provider, so the
     * previous owner-scoped lookup returned 404 for the employer who has to
     * read the text before signing it.
     */
    statementQueryBuilder.getOne.mockResolvedValue({
      id: 'stmt-1',
      groupId: 'group-1',
      organisationId: 'org-1',
      version: 1,
      status: CommitmentStatementStatus.DRAFT,
      content,
      apprenticeUserId: 'u1',
      tutorUserId: 'u2',
      employerManagerUserId: 'u3',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    groupQueryBuilder.getOne.mockResolvedValue({
      id: 'group-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
    });

    const result = await service.findOne(user, 'stmt-1');

    expect(result.id).toBe('stmt-1');
  });

  it('updates draft statement content', async () => {
    statementRepo.findOne.mockResolvedValue({
      id: 'stmt-1',
      groupId: 'group-1',
      organisationId: 'org-1',
      version: 1,
      status: CommitmentStatementStatus.DRAFT,
      content,
      apprenticeUserId: 'u1',
      tutorUserId: 'u2',
      employerManagerUserId: 'u3',
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
    });

    const updated = await service.update(user, 'stmt-1', {
      content: { ...content, trainingPlanSummary: 'Updated plan' },
    });

    expect(updated.content.trainingPlanSummary).toBe('Updated plan');
  });

  it('publishes draft statement and enqueues snapshot PDF', async () => {
    statementRepo.findOne.mockResolvedValue({
      id: 'stmt-1',
      groupId: 'group-1',
      organisationId: 'org-1',
      version: 1,
      status: CommitmentStatementStatus.DRAFT,
      content,
      apprenticeUserId: 'u1',
      tutorUserId: 'u2',
      employerManagerUserId: 'u3',
      snapshotPdfJobId: null,
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
    });
    pdfDispatch.enqueue.mockResolvedValue({ id: 'pdf-job-1' });

    const result = await service.publish(user, 'stmt-1');

    expect(result.status).toBe(CommitmentStatementStatus.SUBMITTED);
    expect(pdfDispatch.enqueue).toHaveBeenCalled();
  });

  it('cancels draft statement', async () => {
    statementRepo.findOne.mockResolvedValue({
      id: 'stmt-1',
      groupId: 'group-1',
      organisationId: 'org-1',
      version: 1,
      status: CommitmentStatementStatus.DRAFT,
      content,
      apprenticeUserId: 'u1',
      tutorUserId: 'u2',
      employerManagerUserId: 'u3',
    });
    groupRepo.findOne.mockResolvedValue({
      id: 'group-1',
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
    });

    const result = await service.cancel(user, 'stmt-1');

    expect(result.status).toBe(CommitmentStatementStatus.CANCELLED);
  });

  it('finds statement entity by id', async () => {
    const entity = {
      id: 'stmt-1',
      organisationId: 'org-1',
    } as CommitmentStatement;
    statementRepo.findOne.mockResolvedValue(entity);

    await expect(service.findStatementEntity(user, 'stmt-1')).resolves.toEqual(
      entity,
    );
  });

  it('maps statement entity to response DTO', () => {
    const statement = {
      id: 'stmt-1',
      groupId: 'group-1',
      organisationId: 'org-1',
      version: 1,
      status: CommitmentStatementStatus.DRAFT,
      content,
      apprenticeUserId: 'u1',
      tutorUserId: 'u2',
      employerManagerUserId: 'u3',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
      publishedAt: null,
      publishedByUserId: null,
      supersededAt: null,
      snapshotPdfJobId: null,
      finalSignedPdfKey: null,
    } as CommitmentStatement;
    const group = {
      enrolmentId: 'enr-1',
      apprenticeId: 'app-1',
    } as CommitmentStatementGroup;

    const response = service.toResponse(statement, group);

    expect(response.enrolmentId).toBe('enr-1');
    expect(response.version).toBe(1);
  });
});
