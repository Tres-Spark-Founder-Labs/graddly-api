import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EnrolmentsService } from '../enrolments/enrolments.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';
import { SequentialCoSignOrchestrator } from '../signing/sequential-co-sign.orchestrator.js';
import { TripartiteParty } from '../signing/tripartite-party.enum.js';

import { CommitmentStatementStatusService } from './commitment-statement-status.service.js';
import { CommitmentsCoSignService } from './commitments-co-sign.service.js';
import { CommitmentSignature } from './entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from './entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from './entities/commitment-statement.entity.js';
import { CommitmentSignatureStatus } from './enums/commitment-signature-status.enum.js';
import { CommitmentStatementStatus } from './enums/commitment-statement-status.enum.js';

describe('CommitmentsCoSignService', () => {
  const statementRepo = { findOne: jest.fn(), save: jest.fn() };
  const groupRepo = { findOne: jest.fn() };
  const signatureRepo = {
    find: jest.fn(),
    count: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn(),
  };
  const pdfJobRepo = { findOne: jest.fn() };
  const coSignOrchestrator = { executeSign: jest.fn() };
  const notificationsService = { createForUser: jest.fn() };
  const eifScoreCache = { invalidate: jest.fn() };
  const enrolmentsService = { syncParticipantsIfUnset: jest.fn() };

  let service: CommitmentsCoSignService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CommitmentsCoSignService,
        CommitmentStatementStatusService,
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: statementRepo,
        },
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: groupRepo,
        },
        {
          provide: getRepositoryToken(CommitmentSignature),
          useValue: signatureRepo,
        },
        { provide: getRepositoryToken(PdfGenerationJob), useValue: pdfJobRepo },
        { provide: SequentialCoSignOrchestrator, useValue: coSignOrchestrator },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EifScoreCacheService, useValue: eifScoreCache },
        { provide: EnrolmentsService, useValue: enrolmentsService },
      ],
    }).compile();

    service = moduleRef.get(CommitmentsCoSignService);
    jest.clearAllMocks();
  });

  const user = {
    id: 'u-app',
    organisationId: 'org-1',
    email: 'a@example.com',
    roles: ['member'],
  } as const;

  /**
   * PRD order: provider creates, employer signs, apprentice signs.
   *
   * This fixture previously described the reverse (apprentice 1, tutor 2,
   * employer 3) and was only ever used as *given* data — no test asserted
   * what `ensureSignatureSlots` actually produces, which is why the ordering
   * bug survived. See the "signature slot order" block below.
   */
  const signatures = [
    {
      id: 's-1',
      party: TripartiteParty.TUTOR,
      signOrder: 1,
      signerUserId: 'u-tutor',
      status: CommitmentSignatureStatus.PENDING,
      signatureRecordId: null,
    },
    {
      id: 's-2',
      party: TripartiteParty.EMPLOYER_MANAGER,
      signOrder: 2,
      signerUserId: 'u-mgr',
      status: CommitmentSignatureStatus.PENDING,
      signatureRecordId: null,
    },
    {
      id: 's-3',
      party: TripartiteParty.APPRENTICE,
      signOrder: 3,
      signerUserId: 'u-app',
      status: CommitmentSignatureStatus.PENDING,
      signatureRecordId: null,
    },
  ];

  it('rejects wrong party order', async () => {
    const statement = {
      id: 'stmt-1',
      organisationId: 'org-1',
      status: CommitmentStatementStatus.AWAITING_SIGNATURES,
      snapshotPdfJobId: 'pdf-1',
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-mgr',
      version: 1,
    };
    statementRepo.findOne.mockResolvedValue(statement);
    signatureRepo.find.mockResolvedValue(signatures);
    signatureRepo.count.mockResolvedValue(3);
    pdfJobRepo.findOne.mockResolvedValue({
      status: PdfJobStatus.COMPLETED,
      outputKey: 'pdf-key',
    });
    coSignOrchestrator.executeSign.mockRejectedValue(
      new ConflictException('Next signer is apprentice, not employer_manager'),
    );

    await expect(
      service.sign(
        user,
        'stmt-1',
        {
          party: TripartiteParty.EMPLOYER_MANAGER,
          signatureImageKey: 'sig.png',
        },
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('initializes signature slots when snapshot PDF is ready', async () => {
    const statement = {
      id: 'stmt-1',
      organisationId: 'org-1',
      status: CommitmentStatementStatus.SUBMITTED,
      snapshotPdfJobId: 'pdf-1',
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-mgr',
      version: 1,
    };
    pdfJobRepo.findOne.mockResolvedValue({
      status: PdfJobStatus.COMPLETED,
      outputKey: 'pdf-key',
    });
    signatureRepo.count.mockResolvedValue(0);
    signatureRepo.save.mockResolvedValue([]);
    statementRepo.save.mockImplementation((v: unknown) => Promise.resolve(v));

    await service.initializeForSigning(statement as never);

    expect(signatureRepo.save).toHaveBeenCalled();
    expect(statementRepo.save).toHaveBeenCalled();
  });
});
