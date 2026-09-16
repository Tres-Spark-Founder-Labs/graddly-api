import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  getRlsBootstrap,
  resetSynchronousTenantFallback,
  runWithCorrelationId,
} from '../common/context/correlation-id-context.js';
import { DAS_CLIENT } from '../das/das-client.constants.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfDispatchService } from '../pdf/pdf-dispatch.service.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';
import { StorageService } from '../storage/storage.service.js';

import { TransferRoleFilter } from './dto/list-transfers-query.dto.js';
import { DasDonorLink } from './entities/das-donor-link.entity.js';
import { DasDonorOAuthToken } from './entities/das-donor-oauth-token.entity.js';
import { LevyMatchApplication } from './entities/levy-match-application.entity.js';
import { LevyTransferDocument } from './entities/levy-transfer-document.entity.js';
import { LevyTransferSignature } from './entities/levy-transfer-signature.entity.js';
import { LevyTransfer } from './entities/levy-transfer.entity.js';
import { LevyMatchApplicationStatus } from './enums/levy-match-application-status.enum.js';
import { LevyTransferDocumentStatus } from './enums/levy-transfer-document-status.enum.js';
import { LevyTransferParty } from './enums/levy-transfer-party.enum.js';
import { LevyTransferStatus } from './enums/levy-transfer-status.enum.js';
import { BilateralCoSignOrchestrator } from './services/bilateral-co-sign.orchestrator.js';
import { DasDonorOAuthService } from './services/das-donor-oauth.service.js';
import { LevyTransferService } from './services/levy-transfer.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

describe('LevyTransferService', () => {
  let service: LevyTransferService;

  const transferFindOne = jest.fn();
  const transferCreate = jest.fn();
  const transferSave = jest.fn();
  const qbGetManyAndCount = jest.fn();
  const qbAndWhere = jest.fn();
  const qbWhere = jest.fn();
  const qbOrderBy = jest.fn();
  const qbSkip = jest.fn();
  const qbTake = jest.fn();

  const documentCreate = jest.fn();
  const documentSave = jest.fn();
  const documentFindOne = jest.fn();

  const signatureFind = jest.fn();
  const signatureCount = jest.fn();
  const signatureCreate = jest.fn();
  const signatureSave = jest.fn();

  const matchFindOne = jest.fn();
  const organisationFindOne = jest.fn();
  const donorLinkFindOne = jest.fn();
  const donorTokenFindOne = jest.fn();
  const pdfJobFindOne = jest.fn();

  const enqueue = jest.fn();
  const executeSign = jest.fn();
  const createLevyTransferConsent = jest.fn();
  const fetchTransferStatus = jest.fn();
  const refreshToken = jest.fn();
  const createDownloadUrl = jest.fn();

  const user: AuthenticatedUser = {
    id: 'user-1',
    email: 'donor@example.com',
    organisationId: 'donor-org',
    roles: ['owner'],
  };

  beforeEach(async () => {
    const queryBuilder = {
      where: qbWhere.mockReturnThis(),
      andWhere: qbAndWhere.mockReturnThis(),
      orderBy: qbOrderBy.mockReturnThis(),
      skip: qbSkip.mockReturnThis(),
      take: qbTake.mockReturnThis(),
      getManyAndCount: qbGetManyAndCount,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyTransferService,
        {
          provide: getRepositoryToken(LevyTransfer),
          useValue: {
            findOne: transferFindOne,
            create: transferCreate,
            save: transferSave,
            createQueryBuilder: jest.fn(() => queryBuilder),
          },
        },
        {
          provide: getRepositoryToken(LevyTransferDocument),
          useValue: {
            create: documentCreate,
            save: documentSave,
            findOne: documentFindOne,
          },
        },
        {
          provide: getRepositoryToken(LevyTransferSignature),
          useValue: {
            find: signatureFind,
            count: signatureCount,
            create: signatureCreate,
            save: signatureSave,
          },
        },
        {
          provide: getRepositoryToken(LevyMatchApplication),
          useValue: { findOne: matchFindOne },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findOne: organisationFindOne },
        },
        {
          provide: getRepositoryToken(DasDonorLink),
          useValue: { findOne: donorLinkFindOne },
        },
        {
          provide: getRepositoryToken(DasDonorOAuthToken),
          useValue: { findOne: donorTokenFindOne },
        },
        {
          provide: getRepositoryToken(PdfGenerationJob),
          useValue: { findOne: pdfJobFindOne },
        },
        {
          provide: PdfDispatchService,
          useValue: { enqueue },
        },
        {
          provide: BilateralCoSignOrchestrator,
          useValue: { executeSign },
        },
        {
          provide: DAS_CLIENT,
          useValue: { createLevyTransferConsent, fetchTransferStatus },
        },
        {
          provide: DasDonorOAuthService,
          useValue: { refreshToken },
        },
        {
          provide: StorageService,
          useValue: {
            getObjectBuffer: jest.fn(),
            putObject: jest.fn(),
            createDownloadUrl,
          },
        },
        {
          provide: StorageKeyBuilder,
          useValue: {
            build: jest.fn(
              ({
                organisationId,
                filename,
              }: {
                organisationId: string;
                filename: string;
              }) => `orgs/${organisationId}/export/${filename}`,
            ),
            belongsToOrganisation: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(LevyTransferService);
    jest.clearAllMocks();
    signatureFind.mockResolvedValue([]);
  });

  describe('list', () => {
    it('filters by donor role and paginates', async () => {
      const row = {
        id: 'transfer-1',
        donorOrganisationId: 'donor-org',
        recipientOrganisationId: 'recipient-org',
        matchApplicationId: 'match-1',
        amount: '5000.00',
        programmeDetails: null,
        esfaTransferReference: null,
        status: LevyTransferStatus.DRAFT,
        startDate: null,
        confirmedAt: null,
        expiryDate: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      qbGetManyAndCount.mockResolvedValue([[row], 1]);

      const result = await service.list(
        { ...user, organisationId: 'donor-org' },
        {
          role: TransferRoleFilter.DONOR,
          page: 1,
          perPage: 20,
        },
      );

      expect(qbAndWhere).toHaveBeenCalledWith(
        'transfer.donorOrganisationId = :organisationId',
        { organisationId: 'donor-org' },
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'transfer-1',
        status: LevyTransferStatus.DRAFT,
      });
      expect(result.meta).toMatchObject({ total: 1, page: 1, perPage: 20 });
    });

    it('matches donor-or-recipient when no role filter is given', async () => {
      qbGetManyAndCount.mockResolvedValue([[], 0]);

      await service.list({ ...user, organisationId: 'org-1' }, {});

      expect(qbAndWhere).toHaveBeenCalledWith(
        '(transfer.donorOrganisationId = :organisationId OR transfer.recipientOrganisationId = :organisationId)',
        { organisationId: 'org-1' },
      );
    });
  });

  it('creates transfer from confirmed match', async () => {
    matchFindOne.mockResolvedValue({
      id: 'match-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      requestedAmount: '10000.00',
      status: LevyMatchApplicationStatus.CONFIRMED,
    });
    transferCreate.mockImplementation((value: LevyTransfer) => value);
    transferSave.mockImplementation((value: LevyTransfer) => ({
      ...value,
      id: 'transfer-1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    }));
    enqueue.mockResolvedValue({ id: 'pdf-job-1' });
    documentCreate.mockImplementation((value: LevyTransferDocument) => value);
    signatureCount.mockResolvedValue(0);
    signatureCreate.mockImplementation((value: LevyTransferSignature) => value);

    const result = await service.createFromMatch(user, {
      matchApplicationId: 'match-1',
      recipientSignerUserId: 'recipient-user',
    });

    expect(result.id).toBe('transfer-1');
    expect(result.status).toBe(LevyTransferStatus.DRAFT);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ transferId: 'transfer-1' }),
    );
    expect(signatureSave).toHaveBeenCalled();
  });

  it('rejects create when match is not confirmed', async () => {
    matchFindOne.mockResolvedValue({
      id: 'match-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      requestedAmount: '10000.00',
      status: LevyMatchApplicationStatus.PENDING,
    });

    await expect(
      service.createFromMatch(user, {
        matchApplicationId: 'match-1',
        recipientSignerUserId: 'recipient-user',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findOne returns transfer for donor org', async () => {
    transferFindOne.mockResolvedValue({
      id: 'transfer-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      matchApplicationId: 'match-1',
      amount: '10000.00',
      programmeDetails: null,
      esfaTransferReference: null,
      status: LevyTransferStatus.DRAFT,
      startDate: null,
      confirmedAt: null,
      expiryDate: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    const result = await service.findOne(user, 'transfer-1');
    expect(result.id).toBe('transfer-1');
  });

  it('findOne throws when transfer is missing', async () => {
    transferFindOne.mockResolvedValue(null);
    await expect(service.findOne(user, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('submitToDas requires donor organisation', async () => {
    transferFindOne.mockResolvedValue({
      id: 'transfer-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      amount: '10000.00',
      status: LevyTransferStatus.PENDING_ESFA,
      startDate: '2026-04-01',
      esfaTransferReference: null,
    });

    await expect(
      service.submitToDas(
        { ...user, organisationId: 'recipient-org' },
        'transfer-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sign rejects closed transfers', async () => {
    transferFindOne.mockResolvedValue({
      id: 'transfer-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      status: LevyTransferStatus.CONFIRMED,
    });

    await expect(
      service.sign(
        user,
        'transfer-1',
        {
          party: LevyTransferParty.DONOR,
          signatureImageKey: 'orgs/donor-org/signature/signature.png',
        },
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('submits signed transfer to DAS as donor', async () => {
    transferFindOne.mockResolvedValue({
      id: 'transfer-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      amount: '10000.00',
      status: LevyTransferStatus.PENDING_ESFA,
      startDate: '2026-04-01',
      esfaTransferReference: null,
    });
    organisationFindOne.mockResolvedValue({ ukprn: '87654321' });
    donorLinkFindOne.mockResolvedValue({
      id: 'link-1',
      organisationId: 'donor-org',
      ukprn: '12345678',
      status: 'linked',
    });
    donorTokenFindOne.mockResolvedValue({ id: 'token-1' });
    refreshToken.mockResolvedValue({ accessToken: 'access-token' });
    createLevyTransferConsent.mockResolvedValue({
      reference: 'ESFA-REF-1',
      raw: { status: 'confirmed' },
    });
    transferSave.mockImplementation((value: LevyTransfer) =>
      Promise.resolve({
        ...value,
        confirmedAt: new Date('2026-01-02'),
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      }),
    );

    const result = await service.submitToDas(user, 'transfer-1');
    expect(organisationFindOne).toHaveBeenCalledWith({
      where: { id: 'recipient-org', isDeleted: false },
      select: ['ukprn'],
    });
    expect(createLevyTransferConsent).toHaveBeenCalledWith(
      expect.objectContaining({ recipientAccount: '87654321' }),
      'access-token',
    );
    expect(result.esfaTransferReference).toBe('ESFA-REF-1');
    expect(result.status).toBe(LevyTransferStatus.CONFIRMED);
  });

  it('returns transfer document with download URL', async () => {
    transferFindOne.mockResolvedValue({
      id: 'transfer-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
    });
    documentFindOne.mockResolvedValue({
      id: 'doc-1',
      transferId: 'transfer-1',
      organisationId: 'donor-org',
      pdfJobId: 'pdf-1',
      status: 'ready',
      unsignedStorageKey: 'orgs/donor-org/pdf/agreement.pdf',
      signedStorageKey: null,
    });
    createDownloadUrl.mockResolvedValue({
      downloadUrl: 'https://example.com/download',
      expiresAt: new Date('2027-01-01'),
    });

    const result = await service.getDocument(user, 'transfer-1');
    expect(result.id).toBe('doc-1');
    expect(result.downloadUrl).toBe('https://example.com/download');
  });

  it('syncs transfer status from DAS', async () => {
    const transfer: LevyTransfer = {
      id: 'transfer-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      matchApplicationId: 'match-1',
      amount: '10000.00',
      programmeDetails: null,
      esfaTransferReference: 'ESFA-REF-1',
      status: LevyTransferStatus.CONFIRMED,
      startDate: '2026-04-01',
      confirmedAt: new Date('2026-01-01'),
      expiryDate: null,
      dasStatusPayload: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      isDeleted: false,
      deletedAt: null,
    };
    donorLinkFindOne.mockResolvedValue({
      id: 'link-1',
      organisationId: 'donor-org',
      status: 'linked',
    });
    donorTokenFindOne.mockResolvedValue({ id: 'token-1' });
    refreshToken.mockResolvedValue({ accessToken: 'access-token' });
    fetchTransferStatus.mockResolvedValue({
      status: 'active',
      raw: { status: 'active' },
    });
    transferSave.mockImplementation((value: LevyTransfer) =>
      Promise.resolve(value),
    );

    await service.syncTransferStatusFromDas(transfer);
    expect(transfer.status).toBe(LevyTransferStatus.ACTIVE);
    expect(transferSave).toHaveBeenCalled();
  });

  /**
   * The can-sign-now signal. Built like CommitmentBoardRowDto.actionRequired:
   * a party is asked to sign when it is next, not merely unsigned — while the
   * donor has not signed, status is pending_signatures for both parties, and
   * that is exactly why status is not the signal.
   */
  describe('signing state on the transfer DTO', () => {
    const openTransfer = (overrides = {}) => ({
      id: 'transfer-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      matchApplicationId: 'match-1',
      amount: '10000.00',
      programmeDetails: null,
      esfaTransferReference: null,
      status: LevyTransferStatus.PENDING_SIGNATURES,
      startDate: null,
      confirmedAt: null,
      expiryDate: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      ...overrides,
    });
    const slot = (
      party: LevyTransferParty,
      signOrder: number,
      userId: string,
      signedAt: Date | null = null,
    ) => ({
      transferId: 'transfer-1',
      party,
      signOrder,
      userId,
      signedAt,
      signatureRecordId: signedAt ? `rec-${party}` : null,
    });
    const donorUser = {
      ...user,
      id: 'donor-signer',
      organisationId: 'donor-org',
      roles: ['member'],
    };
    const recipientUser = {
      ...user,
      id: 'recipient-signer',
      organisationId: 'recipient-org',
      roles: ['member'],
    };

    it('asks the donor first, and not the recipient', async () => {
      transferFindOne.mockResolvedValue(openTransfer());
      signatureFind.mockResolvedValue([
        slot(LevyTransferParty.DONOR, 1, 'donor-signer'),
        slot(LevyTransferParty.RECIPIENT, 2, 'recipient-signer'),
      ]);

      const asDonor = await service.findOne(donorUser, 'transfer-1');
      const asRecipient = await service.findOne(recipientUser, 'transfer-1');

      expect(asDonor).toMatchObject({
        nextParty: LevyTransferParty.DONOR,
        actionRequired: true,
      });
      expect(asRecipient).toMatchObject({
        nextParty: LevyTransferParty.DONOR,
        actionRequired: false,
      });
      expect(asRecipient.signatures).toEqual([
        { party: 'donor', signOrder: 1, signed: false, signedAt: null },
        { party: 'recipient', signOrder: 2, signed: false, signedAt: null },
      ]);
    });

    it('turns to the recipient once the donor has signed', async () => {
      transferFindOne.mockResolvedValue(openTransfer());
      signatureFind.mockResolvedValue([
        slot(
          LevyTransferParty.DONOR,
          1,
          'donor-signer',
          new Date('2026-02-01'),
        ),
        slot(LevyTransferParty.RECIPIENT, 2, 'recipient-signer'),
      ]);

      const asDonor = await service.findOne(donorUser, 'transfer-1');
      const asRecipient = await service.findOne(recipientUser, 'transfer-1');

      expect(asRecipient).toMatchObject({
        nextParty: LevyTransferParty.RECIPIENT,
        actionRequired: true,
      });
      expect(asDonor.actionRequired).toBe(false);
      expect(asRecipient.signatures[0]).toEqual({
        party: 'donor',
        signOrder: 1,
        signed: true,
        signedAt: '2026-02-01T00:00:00.000Z',
      });
    });

    it('does not invite a member who is neither the assigned signer nor an admin', async () => {
      transferFindOne.mockResolvedValue(openTransfer());
      signatureFind.mockResolvedValue([
        slot(
          LevyTransferParty.DONOR,
          1,
          'donor-signer',
          new Date('2026-02-01'),
        ),
        slot(LevyTransferParty.RECIPIENT, 2, 'recipient-signer'),
      ]);

      const colleague = { ...recipientUser, id: 'someone-else' };
      const admin = { ...colleague, roles: ['admin'] };

      expect(
        (await service.findOne(colleague, 'transfer-1')).actionRequired,
      ).toBe(false);
      expect((await service.findOne(admin, 'transfer-1')).actionRequired).toBe(
        true,
      );
    });

    it('asks nobody before the agreement PDF exists, or after both have signed', async () => {
      signatureFind.mockResolvedValue([
        slot(LevyTransferParty.DONOR, 1, 'donor-signer'),
        slot(LevyTransferParty.RECIPIENT, 2, 'recipient-signer'),
      ]);
      transferFindOne.mockResolvedValue(
        openTransfer({ status: LevyTransferStatus.DRAFT }),
      );
      expect(await service.findOne(donorUser, 'transfer-1')).toMatchObject({
        nextParty: null,
        actionRequired: false,
      });

      signatureFind.mockResolvedValue([
        slot(
          LevyTransferParty.DONOR,
          1,
          'donor-signer',
          new Date('2026-02-01'),
        ),
        slot(
          LevyTransferParty.RECIPIENT,
          2,
          'recipient-signer',
          new Date('2026-02-02'),
        ),
      ]);
      transferFindOne.mockResolvedValue(
        openTransfer({ status: LevyTransferStatus.PENDING_ESFA }),
      );
      expect(await service.findOne(recipientUser, 'transfer-1')).toMatchObject({
        nextParty: null,
        actionRequired: false,
      });
    });
  });

  /** F4.2.4 AC3 — the recipient signs last and closes the agreement. */
  describe('the final signature', () => {
    const recipient: AuthenticatedUser = {
      id: 'recipient-signer',
      email: 'recipient@example.com',
      organisationId: 'recipient-org',
      roles: ['member'],
    };
    const openTransfer = () => ({
      id: 'transfer-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      amount: '10000.00',
      status: LevyTransferStatus.PENDING_SIGNATURES,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
    const readyDocument = () => ({
      id: 'doc-1',
      transferId: 'transfer-1',
      organisationId: 'donor-org',
      pdfJobId: 'pdf-1',
      status: LevyTransferDocumentStatus.READY,
      unsignedStorageKey: 'orgs/donor-org/export/agreement.pdf',
      signedStorageKey: null as string | null,
      recipientSignedStorageKey: null as string | null,
    });
    const donorSignedSlots = () => [
      {
        transferId: 'transfer-1',
        party: LevyTransferParty.DONOR,
        signOrder: 1,
        userId: 'donor-signer',
        signedAt: new Date('2026-02-01'),
        signatureRecordId: 'rec-1',
      },
      {
        transferId: 'transfer-1',
        party: LevyTransferParty.RECIPIENT,
        signOrder: 2,
        userId: 'recipient-signer',
        signedAt: null,
        signatureRecordId: null,
      },
    ];
    const signAsRecipient = () =>
      service.sign(
        recipient,
        'transfer-1',
        {
          party: LevyTransferParty.RECIPIENT,
          signatureImageKey: 'orgs/recipient-org/signature/s.png',
        },
        '127.0.0.1',
      );

    beforeEach(() => {
      transferFindOne.mockImplementation(() => Promise.resolve(openTransfer()));
      pdfJobFindOne.mockResolvedValue(null);
      signatureFind.mockResolvedValue(donorSignedSlots());
      executeSign.mockResolvedValue({
        party: LevyTransferParty.RECIPIENT,
        signedPdfKey: 'orgs/recipient-org/signatures/signed.pdf',
        downloadUrl: 'https://example.com/temporary',
        downloadExpiresAt: '2026-02-02T00:00:00.000Z',
        signatureRecordId: 'rec-2',
        nextParty: null,
      });
      transferSave.mockImplementation((v: unknown) => Promise.resolve(v));
      documentSave.mockImplementation((v: unknown) => Promise.resolve(v));
    });

    it('gives each party a lasting copy in its own storage', async () => {
      const document = readyDocument();
      documentFindOne.mockResolvedValue(document);

      await signAsRecipient();

      expect(document).toMatchObject({
        status: LevyTransferDocumentStatus.SIGNED,
        signedStorageKey:
          'orgs/donor-org/export/levy-transfer-signed-transfer-1.pdf',
        recipientSignedStorageKey:
          'orgs/recipient-org/export/levy-transfer-signed-transfer-1.pdf',
      });
      expect(transferSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: LevyTransferStatus.PENDING_ESFA }),
      );
    });

    /**
     * Under RLS an UPDATE the policies refuse affects no rows and save() does
     * not say so. The read-back is what turns that into an error — and the
     * transfer must not be marked fully signed over an agreement that was not.
     */
    it('does not mark the transfer fully signed when the agreement could not be recorded', async () => {
      const document = readyDocument();
      documentFindOne
        .mockResolvedValueOnce(document)
        .mockResolvedValueOnce(document)
        .mockResolvedValueOnce(readyDocument());

      await expect(signAsRecipient()).rejects.toBeInstanceOf(ConflictException);
      expect(transferSave).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: LevyTransferStatus.PENDING_ESFA }),
      );
    });
  });
  /**
   * The counterparty case of the bootstrap rule on withRlsBootstrap. The four
   * conditions, at this call site: named column, exclusive window, after the
   * authorisation check, and nothing else read.
   */
  describe("the recipient's UKPRN, read in a bootstrap window", () => {
    const signedTransfer = () => ({
      id: 'transfer-1',
      donorOrganisationId: 'donor-org',
      recipientOrganisationId: 'recipient-org',
      amount: '10000.00',
      status: LevyTransferStatus.PENDING_ESFA,
      startDate: '2026-04-01',
      esfaTransferReference: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });

    const inRequest = <T>(fn: () => Promise<T>): Promise<T> =>
      runWithCorrelationId({ correlationId: 'transfer-spec' }, fn);

    beforeEach(() => {
      resetSynchronousTenantFallback();
      transferFindOne.mockResolvedValue(signedTransfer());
      donorLinkFindOne.mockResolvedValue({
        id: 'link-1',
        organisationId: 'donor-org',
        ukprn: '12345678',
        status: 'linked',
      });
      donorTokenFindOne.mockResolvedValue({ id: 'token-1' });
      refreshToken.mockResolvedValue({ accessToken: 'access-token' });
      createLevyTransferConsent.mockResolvedValue({
        reference: 'ESFA-REF-1',
        raw: { status: 'confirmed' },
      });
      transferSave.mockImplementation((value: unknown) =>
        Promise.resolve({
          ...(value as Record<string, unknown>),
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
        }),
      );
    });

    it('sets the flag for that read and puts it back', async () => {
      const flagDuringRead: boolean[] = [];
      organisationFindOne.mockImplementation(() => {
        flagDuringRead.push(getRlsBootstrap());
        return Promise.resolve({ ukprn: '87654321' });
      });

      await inRequest(async () => {
        expect(getRlsBootstrap()).toBe(false);
        await service.submitToDas(user, 'transfer-1');
        expect(flagDuringRead).toEqual([true]);
        expect(getRlsBootstrap()).toBe(false);
      });
    });

    it('opens no window for a caller that is not the donor', async () => {
      organisationFindOne.mockResolvedValue({ ukprn: '87654321' });

      await expect(
        service.submitToDas(
          { ...user, organisationId: 'recipient-org' },
          'transfer-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(organisationFindOne).not.toHaveBeenCalled();
    });

    it('refuses to submit when the recipient has no UKPRN', async () => {
      organisationFindOne.mockResolvedValue({ ukprn: null });

      await expect(
        service.submitToDas(user, 'transfer-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createLevyTransferConsent).not.toHaveBeenCalled();
    });
  });
});
