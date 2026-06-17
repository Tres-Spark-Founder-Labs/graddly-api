import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageService } from '../storage/storage.service.js';

import { LearnerDocumentType } from './enums/learner-document-type.enum.js';
import { LearnerDocumentsService } from './learner-documents.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

const user = {
  id: 'app-user-1',
  organisationId: 'org-1',
} as AuthenticatedUser;

describe('LearnerDocumentsService', () => {
  const enrolmentRepo = { find: jest.fn() };
  const commitmentGroupRepo = { findOne: jest.fn() };
  const commitmentRepo = { findOne: jest.fn() };
  const reviewRepo = { find: jest.fn() };
  const pdfJobRepo = { findOne: jest.fn() };
  const evidenceRepo = { find: jest.fn() };
  const storage = { createDownloadUrl: jest.fn() };

  let service: LearnerDocumentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    enrolmentRepo.find.mockResolvedValue([
      { id: 'enrol-1', organisationId: 'org-1' },
    ]);
    commitmentGroupRepo.findOne.mockResolvedValue(null);
    reviewRepo.find.mockResolvedValue([]);
    evidenceRepo.find.mockResolvedValue([
      {
        id: 'ev-1',
        title: 'Accepted evidence',
        acceptedAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        storageKey: 'orgs/org-1/learners/a1/evidence/obj1/file.pdf',
        externalUrl: null,
      },
    ]);
    storage.createDownloadUrl.mockResolvedValue({
      downloadUrl: 'https://download.example.com/file.pdf',
      expiresAt: new Date('2026-02-02T00:00:00.000Z'),
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LearnerDocumentsService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: commitmentGroupRepo,
        },
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: commitmentRepo,
        },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        {
          provide: getRepositoryToken(PdfGenerationJob),
          useValue: pdfJobRepo,
        },
        { provide: getRepositoryToken(KsEvidenceItem), useValue: evidenceRepo },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(LearnerDocumentsService);
  });

  describe('listMyDocuments', () => {
    it('returns evidence with presigned download URLs', async () => {
      const result = await service.listMyDocuments(user, {});

      expect(result.enrolments).toHaveLength(1);
      expect(result.enrolments[0]?.items).toHaveLength(1);
      const item = result.enrolments[0]?.items[0];
      expect(item?.type).toBe(LearnerDocumentType.EVIDENCE);
      expect(item?.downloadUrl).toBe('https://download.example.com/file.pdf');
    });

    it('rejects enrolment filter not linked to user', async () => {
      await expect(
        service.listMyDocuments(user, { enrolmentId: 'other-enrol' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
