import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageService } from '../storage/storage.service.js';

import { QipAction } from './entities/qip-action.entity.js';
import { EvidencePackBuilderService } from './evidence-pack-builder.service.js';

describe('EvidencePackBuilderService', () => {
  const emptyRepo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };
  const storage = {
    getObjectBuffer: jest.fn(),
  };

  let service: EvidencePackBuilderService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EvidencePackBuilderService,
        { provide: getRepositoryToken(OtjLogEntry), useValue: emptyRepo },
        { provide: getRepositoryToken(Review), useValue: emptyRepo },
        { provide: getRepositoryToken(PdfGenerationJob), useValue: emptyRepo },
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: emptyRepo,
        },
        { provide: getRepositoryToken(IlrLearnerRecord), useValue: emptyRepo },
        { provide: getRepositoryToken(KsEvidenceItem), useValue: emptyRepo },
        { provide: getRepositoryToken(QipAction), useValue: emptyRepo },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = moduleRef.get(EvidencePackBuilderService);
    jest.clearAllMocks();
  });

  it('builds a ZIP with manifest keys for each EIF theme', async () => {
    const { buffer, manifest } = await service.buildZipBuffer('org-1');
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(manifest['curriculum_intent']).toBe(0);
    expect(manifest['curriculum_implementation']).toBe(0);
    expect(manifest['curriculum_impact']).toBe(0);
    expect(manifest['behaviour_attitudes']).toBe(1);
    expect(manifest['personal_development']).toBe(0);
    expect(manifest['leadership_management']).toBe(0);
    expect(manifest['safeguarding']).toBe(0);
    expect(manifest.custom).toBe(0);
  });
});
