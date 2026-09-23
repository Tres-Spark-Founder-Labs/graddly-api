import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { testAuthenticatedUser } from '../auth/testing/authenticated-user.fixture.js';
import { EsignatureService } from '../esignature/esignature.service.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';

import { SequentialCoSignOrchestrator } from './sequential-co-sign.orchestrator.js';
import { TripartiteParty } from './tripartite-party.enum.js';

describe('SequentialCoSignOrchestrator', () => {
  const esignatureService = {
    createRecord: jest.fn(),
    completeSigning: jest.fn(),
    findOne: jest.fn(),
  };
  const pdfJobRepo = { findOne: jest.fn() };

  let orchestrator: SequentialCoSignOrchestrator;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SequentialCoSignOrchestrator,
        { provide: EsignatureService, useValue: esignatureService },
        {
          provide: getRepositoryToken(PdfGenerationJob),
          useValue: pdfJobRepo,
        },
      ],
    }).compile();

    orchestrator = moduleRef.get(SequentialCoSignOrchestrator);
    jest.clearAllMocks();
  });

  const user = testAuthenticatedUser({
    id: 'u-app',
    organisationId: 'org-1',
    roles: ['member'],
  });

  const slots = [
    {
      party: TripartiteParty.APPRENTICE,
      signOrder: 1,
      signerUserId: 'u-app',
      status: 'pending' as const,
      signatureRecordId: null,
    },
    {
      party: TripartiteParty.TUTOR,
      signOrder: 2,
      signerUserId: 'u-tutor',
      status: 'pending' as const,
      signatureRecordId: null,
    },
  ];

  it('rejects wrong party order', async () => {
    pdfJobRepo.findOne.mockResolvedValue({
      id: 'job-1',
      status: PdfJobStatus.COMPLETED,
      outputKey: 'key.pdf',
    });

    await expect(
      orchestrator.executeSign({
        user,
        organisationId: 'org-1',
        requestedParty: TripartiteParty.TUTOR,
        signatureImageKey: 'sig.png',
        clientIp: '127.0.0.1',
        slots,
        snapshotPdfJobId: 'job-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects unassigned signer', async () => {
    pdfJobRepo.findOne.mockResolvedValue({
      id: 'job-1',
      status: PdfJobStatus.COMPLETED,
      outputKey: 'key.pdf',
    });

    await expect(
      orchestrator.executeSign({
        user: testAuthenticatedUser({
          id: 'u-other',
          organisationId: 'org-1',
          roles: ['member'],
        }),
        organisationId: 'org-1',
        requestedParty: TripartiteParty.APPRENTICE,
        signatureImageKey: 'sig.png',
        clientIp: '127.0.0.1',
        slots,
        snapshotPdfJobId: 'job-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
