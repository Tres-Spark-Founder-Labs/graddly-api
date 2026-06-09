import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { SequentialCoSignOrchestrator } from '../signing/sequential-co-sign.orchestrator.js';

import { ReviewSignature } from './entities/review-signature.entity.js';
import { Review } from './entities/review.entity.js';
import { ReviewSignatureStatus } from './enums/review-signature-status.enum.js';
import { ReviewSignerParty } from './enums/review-signer-party.enum.js';
import { ReviewStatus } from './enums/review-status.enum.js';
import { ReviewsCoSignService } from './reviews-co-sign.service.js';

describe('ReviewsCoSignService', () => {
  const reviewRepo = { findOne: jest.fn(), save: jest.fn() };
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

  let service: ReviewsCoSignService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsCoSignService,
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        {
          provide: getRepositoryToken(ReviewSignature),
          useValue: signatureRepo,
        },
        {
          provide: getRepositoryToken(PdfGenerationJob),
          useValue: pdfJobRepo,
        },
        {
          provide: SequentialCoSignOrchestrator,
          useValue: coSignOrchestrator,
        },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EifScoreCacheService, useValue: eifScoreCache },
      ],
    }).compile();

    service = moduleRef.get(ReviewsCoSignService);
    jest.clearAllMocks();
  });

  const owner = {
    id: 'u-tutor',
    organisationId: 'org-1',
    email: 'tutor@example.com',
    roles: ['owner'],
  } as const;

  const signatures = [
    {
      id: 's-1',
      party: ReviewSignerParty.APPRENTICE,
      signOrder: 1,
      signerUserId: 'u-app',
      status: ReviewSignatureStatus.PENDING,
      signatureRecordId: null,
    },
    {
      id: 's-2',
      party: ReviewSignerParty.TUTOR,
      signOrder: 2,
      signerUserId: 'u-tutor',
      status: ReviewSignatureStatus.PENDING,
      signatureRecordId: null,
    },
    {
      id: 's-3',
      party: ReviewSignerParty.EMPLOYER_MANAGER,
      signOrder: 3,
      signerUserId: 'u-emp',
      status: ReviewSignatureStatus.PENDING,
      signatureRecordId: null,
    },
  ];

  it('rejects wrong party order', async () => {
    reviewRepo.findOne.mockResolvedValue({
      id: 'r-1',
      organisationId: 'org-1',
      status: ReviewStatus.AWAITING_SIGNATURES,
      snapshotPdfJobId: 'job-1',
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-emp',
    });
    signatureRepo.count.mockResolvedValue(3);
    signatureRepo.find.mockResolvedValue(signatures);
    coSignOrchestrator.executeSign.mockRejectedValue(
      new ConflictException('Next signer is apprentice'),
    );

    await expect(
      service.sign(
        owner,
        'r-1',
        {
          party: ReviewSignerParty.EMPLOYER_MANAGER,
          signatureImageKey: 'orgs/org-1/signature/x.png',
        },
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects signer who is not assigned party', async () => {
    reviewRepo.findOne.mockResolvedValue({
      id: 'r-1',
      organisationId: 'org-1',
      status: ReviewStatus.AWAITING_SIGNATURES,
      snapshotPdfJobId: 'job-1',
      apprenticeUserId: 'u-app',
      tutorUserId: 'u-tutor',
      employerManagerUserId: 'u-emp',
    });
    signatureRepo.count.mockResolvedValue(3);
    signatureRepo.find.mockResolvedValue(signatures);
    coSignOrchestrator.executeSign.mockRejectedValue(
      new ForbiddenException('not assigned'),
    );

    const wrongUser = {
      id: 'u-other',
      organisationId: 'org-1',
      roles: ['member'],
    } as const;

    await expect(
      service.sign(
        wrongUser,
        'r-1',
        {
          party: ReviewSignerParty.APPRENTICE,
          signatureImageKey: 'orgs/org-1/signature/x.png',
        },
        '127.0.0.1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
