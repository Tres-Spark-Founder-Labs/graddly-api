import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EsignatureService } from '../esignature/esignature.service.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';

import { LevyTransferParty } from './enums/levy-transfer-party.enum.js';
import { BilateralCoSignOrchestrator } from './services/bilateral-co-sign.orchestrator.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

describe('BilateralCoSignOrchestrator', () => {
  let orchestrator: BilateralCoSignOrchestrator;

  const createRecord = jest.fn();
  const completeSigning = jest.fn();
  const findOneSignature = jest.fn();
  const pdfJobFindOne = jest.fn();

  const donorUser: AuthenticatedUser = {
    id: 'donor-user',
    email: 'donor@example.com',
    organisationId: 'donor-org',
    roles: ['owner'],
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BilateralCoSignOrchestrator,
        {
          provide: EsignatureService,
          useValue: {
            createRecord,
            completeSigning,
            findOne: findOneSignature,
          },
        },
        {
          provide: getRepositoryToken(PdfGenerationJob),
          useValue: { findOne: pdfJobFindOne },
        },
      ],
    }).compile();

    orchestrator = moduleRef.get(BilateralCoSignOrchestrator);
    jest.clearAllMocks();
  });

  it('executes donor sign as first party', async () => {
    pdfJobFindOne.mockResolvedValue({
      id: 'pdf-1',
      organisationId: 'donor-org',
      status: PdfJobStatus.COMPLETED,
      outputKey: 'orgs/donor-org/pdf/agreement.pdf',
    });
    createRecord.mockResolvedValue({ id: 'sig-1' });
    completeSigning.mockResolvedValue({
      signedPdfKey: 'orgs/donor-org/signed/agreement.pdf',
      downloadUrl: 'https://example.com/signed.pdf',
      downloadExpiresAt: new Date('2027-01-01'),
    });

    const result = await orchestrator.executeSign({
      user: donorUser,
      organisationId: 'donor-org',
      pdfOrganisationId: 'donor-org',
      requestedParty: LevyTransferParty.DONOR,
      signatureImageKey: 'orgs/donor-org/signature/signature.png',
      clientIp: '127.0.0.1',
      slots: [
        {
          party: LevyTransferParty.DONOR,
          signOrder: 1,
          signerUserId: 'donor-user',
          status: 'pending',
          signatureRecordId: null,
        },
        {
          party: LevyTransferParty.RECIPIENT,
          signOrder: 2,
          signerUserId: 'recipient-user',
          status: 'pending',
          signatureRecordId: null,
        },
      ],
      snapshotPdfJobId: 'pdf-1',
    });

    expect(result.party).toBe(LevyTransferParty.DONOR);
    expect(result.nextParty).toBe(LevyTransferParty.RECIPIENT);
    expect(createRecord).toHaveBeenCalled();
    expect(completeSigning).toHaveBeenCalledWith(donorUser, 'sig-1');
  });

  it('rejects wrong signing order', async () => {
    await expect(
      orchestrator.executeSign({
        user: donorUser,
        organisationId: 'donor-org',
        pdfOrganisationId: 'donor-org',
        requestedParty: LevyTransferParty.RECIPIENT,
        signatureImageKey: 'orgs/recipient-org/signature/signature.png',
        clientIp: '127.0.0.1',
        slots: [
          {
            party: LevyTransferParty.DONOR,
            signOrder: 1,
            signerUserId: 'donor-user',
            status: 'pending',
            signatureRecordId: null,
          },
        ],
        snapshotPdfJobId: 'pdf-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects unassigned signer', async () => {
    pdfJobFindOne.mockResolvedValue({
      id: 'pdf-1',
      organisationId: 'donor-org',
      status: PdfJobStatus.COMPLETED,
      outputKey: 'orgs/donor-org/pdf/agreement.pdf',
    });

    await expect(
      orchestrator.executeSign({
        user: {
          ...donorUser,
          id: 'other-user',
          roles: ['member'],
        },
        organisationId: 'donor-org',
        pdfOrganisationId: 'donor-org',
        requestedParty: LevyTransferParty.DONOR,
        signatureImageKey: 'orgs/donor-org/signature/signature.png',
        clientIp: '127.0.0.1',
        slots: [
          {
            party: LevyTransferParty.DONOR,
            signOrder: 1,
            signerUserId: 'donor-user',
            status: 'pending',
            signatureRecordId: null,
          },
        ],
        snapshotPdfJobId: 'pdf-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when all parties have signed', async () => {
    await expect(
      orchestrator.executeSign({
        user: donorUser,
        organisationId: 'donor-org',
        pdfOrganisationId: 'donor-org',
        requestedParty: LevyTransferParty.DONOR,
        signatureImageKey: 'orgs/donor-org/signature/signature.png',
        clientIp: '127.0.0.1',
        slots: [
          {
            party: LevyTransferParty.DONOR,
            signOrder: 1,
            signerUserId: 'donor-user',
            status: 'signed',
            signatureRecordId: 'sig-1',
          },
        ],
        snapshotPdfJobId: 'pdf-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
