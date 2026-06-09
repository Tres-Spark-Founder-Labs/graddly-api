import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';
import { PdfService } from '../pdf/pdf.service.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';
import { StorageService } from '../storage/storage.service.js';

import { SignatureRecord } from './entities/signature-record.entity.js';
import { SignatureRecordStatus } from './enums/signature-record-status.enum.js';
import { EsignatureService } from './esignature.service.js';

describe('EsignatureService', () => {
  let service: EsignatureService;
  const recordSave = jest.fn();
  const recordFindOne = jest.fn();
  const pdfJobFindOne = jest.fn();
  const getObjectBuffer = jest.fn();
  const putObject = jest.fn();

  beforeEach(async () => {
    recordSave.mockReset();
    recordFindOne.mockReset();
    pdfJobFindOne.mockReset();
    getObjectBuffer.mockReset();
    putObject.mockReset();

    const moduleRef = await Test.createTestingModule({
      providers: [
        EsignatureService,
        {
          provide: StorageService,
          useValue: {
            getObjectBuffer,
            putObject,
            createDownloadUrl: jest.fn().mockResolvedValue({
              downloadUrl: 'https://example.com/signed.pdf',
              expiresAt: new Date(),
            }),
          },
        },
        {
          provide: StorageKeyBuilder,
          useValue: {
            belongsToOrganisation: jest.fn().mockReturnValue(true),
            build: jest
              .fn()
              .mockReturnValue('orgs/org-1/export/rec-1/signed-rec-1.pdf'),
          },
        },
        {
          provide: PdfService,
          useValue: {
            embedSignature: jest
              .fn()
              .mockResolvedValue(Buffer.from('%PDF-signed')),
          },
        },
        {
          provide: getRepositoryToken(SignatureRecord),
          useValue: {
            create: jest.fn((value: SignatureRecord) => value),
            save: recordSave,
            findOne: recordFindOne,
          },
        },
        {
          provide: getRepositoryToken(PdfGenerationJob),
          useValue: { findOne: pdfJobFindOne },
        },
      ],
    }).compile();

    service = moduleRef.get(EsignatureService);
  });

  const user = {
    id: 'user-1',
    email: 'signer@example.com',
    organisationId: 'org-1',
    roles: ['owner'],
  } as const;

  it('createRecord hashes signature bytes', async () => {
    getObjectBuffer.mockResolvedValue(Buffer.from('png-bytes'));
    pdfJobFindOne.mockResolvedValue({
      id: 'job-1',
      status: PdfJobStatus.COMPLETED,
      outputKey: 'orgs/org-1/export/job-1/hello.pdf',
    });
    recordSave.mockImplementation((record: SignatureRecord) =>
      Promise.resolve({ ...record, id: 'rec-1' }),
    );

    const result = await service.createRecord(
      user,
      {
        signatureImageKey: 'orgs/org-1/signature/obj/sig.png',
        pdfJobId: 'job-1',
      },
      '127.0.0.1',
      'jest',
    );

    expect(result.signatureImageHash).toHaveLength(64);
    expect(result.clientIp).toBe('127.0.0.1');
  });

  it('completeSigning stores signed PDF key', async () => {
    recordFindOne.mockResolvedValue({
      id: 'rec-1',
      organisationId: 'org-1',
      signerUserId: 'user-1',
      signatureImageKey: 'orgs/org-1/signature/obj/sig.png',
      signedAt: new Date(),
      status: SignatureRecordStatus.PENDING,
      pdfGenerationJobId: 'job-1',
    });
    pdfJobFindOne.mockResolvedValue({
      id: 'job-1',
      outputKey: 'orgs/org-1/export/job-1/hello.pdf',
    });
    getObjectBuffer.mockResolvedValue(Buffer.from('bytes'));
    recordSave.mockImplementation((record: SignatureRecord) =>
      Promise.resolve(record),
    );

    const result = await service.completeSigning(user, 'rec-1');

    expect(putObject).toHaveBeenCalled();
    expect(result.signedPdfKey).toContain('signed-rec-1.pdf');
  });

  it('returns signature record for signer', async () => {
    recordFindOne.mockResolvedValue({
      id: 'rec-1',
      organisationId: 'org-1',
      signerUserId: 'user-1',
      signatureImageKey: 'orgs/org-1/signature/obj/sig.png',
      signedAt: new Date(),
      status: SignatureRecordStatus.SIGNED,
      signedPdfKey: 'orgs/org-1/export/rec-1/signed.pdf',
      pdfGenerationJobId: 'job-1',
    });

    const result = await service.findOne(user, 'rec-1');

    expect(result.id).toBe('rec-1');
  });

  it('createRecord rejects incomplete pdf jobs', async () => {
    pdfJobFindOne.mockResolvedValue({
      id: 'job-1',
      status: PdfJobStatus.QUEUED,
      outputKey: null,
    });

    await expect(
      service.createRecord(
        user,
        {
          signatureImageKey: 'orgs/org-1/signature/obj/sig.png',
          pdfJobId: 'job-1',
        },
        '127.0.0.1',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
