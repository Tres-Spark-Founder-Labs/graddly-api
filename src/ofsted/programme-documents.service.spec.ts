import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Programme } from '../programmes/entities/programme.entity.js';
import { ProgrammeStatus } from '../programmes/enums/programme-status.enum.js';

import { EifScoreCacheService } from './eif-score-cache.service.js';
import { ProgrammeDocument } from './entities/programme-document.entity.js';
import { ProgrammeDocumentType } from './enums/programme-document-type.enum.js';
import { ProgrammeDocumentsService } from './programme-documents.service.js';

describe('ProgrammeDocumentsService', () => {
  const docRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const programmeRepo = { findOne: jest.fn(), find: jest.fn() };
  const eifScoreCache = { invalidate: jest.fn() };

  let service: ProgrammeDocumentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProgrammeDocumentsService,
        { provide: getRepositoryToken(ProgrammeDocument), useValue: docRepo },
        { provide: getRepositoryToken(Programme), useValue: programmeRepo },
        { provide: EifScoreCacheService, useValue: eifScoreCache },
      ],
    }).compile();
    service = moduleRef.get(ProgrammeDocumentsService);
  });

  it('computes coverage percent across active programmes', async () => {
    programmeRepo.find.mockResolvedValue([{ id: 'prog-1' }, { id: 'prog-2' }]);
    docRepo.find
      .mockResolvedValueOnce([
        { documentType: ProgrammeDocumentType.CURRICULUM_MAP },
        { documentType: ProgrammeDocumentType.ASSESSMENT_STRATEGY },
        { documentType: ProgrammeDocumentType.INDUSTRY_ENGAGEMENT },
      ])
      .mockResolvedValueOnce([
        { documentType: ProgrammeDocumentType.CURRICULUM_MAP },
      ]);

    const percent = await service.coveragePercent('org-1');
    expect(percent).toBe(67);
    expect(programmeRepo.find).toHaveBeenCalledWith({
      where: {
        organisationId: 'org-1',
        status: ProgrammeStatus.ACTIVE,
        isDeleted: false,
      },
      select: ['id'],
    });
  });
});
