import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageService } from '../storage/storage.service.js';

import { KsEvidenceItem } from './entities/ks-evidence-item.entity.js';
import { KsEvidenceKsbMapping } from './entities/ks-evidence-ksb-mapping.entity.js';
import { KsEvidenceStatus } from './enums/ks-evidence-status.enum.js';
import { KsEvidenceType } from './enums/ks-evidence-type.enum.js';
import { KsbKind } from './enums/ksb-kind.enum.js';
import { EpaPackBuilderService } from './epa-pack-builder.service.js';
import { PortfolioHeatmapService } from './portfolio-heatmap.service.js';

describe('EpaPackBuilderService', () => {
  const enrolmentRepo = { findOne: jest.fn() };
  const evidenceRepo = { find: jest.fn() };
  const mappingRepo = { find: jest.fn() };
  const reviewRepo = { find: jest.fn() };
  const pdfJobRepo = { findOne: jest.fn() };
  const commitmentGroupRepo = { findOne: jest.fn() };
  const commitmentRepo = { findOne: jest.fn() };
  const otjRepo = { find: jest.fn() };
  const heatmapService = { getHeatmap: jest.fn() };
  const storage = { getObjectBuffer: jest.fn() };

  let service: EpaPackBuilderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'enrol-1',
      plannedDurationMonths: 12,
      plannedStartDate: '2025-01-01',
      plannedEndDate: '2026-01-01',
      activatedAt: new Date('2025-01-01'),
      epaDate: '2026-01-01',
    });
    evidenceRepo.find.mockResolvedValue([
      {
        id: 'ev-1',
        type: KsEvidenceType.TEXT,
        title: 'Reflection',
        body: 'STAR statement',
        storageKey: null,
        externalUrl: null,
        status: KsEvidenceStatus.ACCEPTED,
      },
    ]);
    mappingRepo.find.mockResolvedValue([
      {
        evidenceItemId: 'ev-1',
        ksbDefinition: { kind: KsbKind.KNOWLEDGE },
      },
    ]);
    heatmapService.getHeatmap.mockResolvedValue({
      enrolmentId: 'enrol-1',
      cells: [],
    });
    reviewRepo.find.mockResolvedValue([]);
    otjRepo.find.mockResolvedValue([]);
    commitmentGroupRepo.findOne.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EpaPackBuilderService,
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(KsEvidenceItem), useValue: evidenceRepo },
        {
          provide: getRepositoryToken(KsEvidenceKsbMapping),
          useValue: mappingRepo,
        },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        {
          provide: getRepositoryToken(PdfGenerationJob),
          useValue: pdfJobRepo,
        },
        {
          provide: getRepositoryToken(CommitmentStatementGroup),
          useValue: commitmentGroupRepo,
        },
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: commitmentRepo,
        },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        { provide: PortfolioHeatmapService, useValue: heatmapService },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(EpaPackBuilderService);
  });

  describe('buildZipBuffer', () => {
    it('builds a ZIP with knowledge evidence and summaries', async () => {
      const result = await service.buildZipBuffer('org-1', 'enrol-1', 'user-1');

      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.manifest.knowledge).toBeGreaterThan(0);
      expect(result.manifest.summaries).toBeGreaterThanOrEqual(2);
      const findCalls = evidenceRepo.find.mock.calls as Array<
        [{ where: Record<string, unknown> }]
      >;
      expect(findCalls[0]?.[0].where).toMatchObject({
        organisationId: 'org-1',
        enrolmentId: 'enrol-1',
        status: KsEvidenceStatus.ACCEPTED,
      });
    });
  });
});
