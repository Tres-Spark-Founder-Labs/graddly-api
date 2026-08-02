import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import AdmZip from 'adm-zip';

import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageService } from '../storage/storage.service.js';

import { getEifCriterionSlugs } from './eif-criteria.config.js';
import { ProgrammeDocument } from './entities/programme-document.entity.js';
import { QipAction } from './entities/qip-action.entity.js';
import { SafeguardingChecklistItem } from './entities/safeguarding-checklist-item.entity.js';
import { EvidencePackBuilderService } from './evidence-pack-builder.service.js';

function entryNames(buffer: Buffer): string[] {
  return new AdmZip(buffer).getEntries().map((e) => e.entryName);
}

describe('EvidencePackBuilderService', () => {
  const makeRepo = () => ({
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  });

  let otjRepo: ReturnType<typeof makeRepo>;
  let reviewRepo: ReturnType<typeof makeRepo>;
  let pdfJobRepo: ReturnType<typeof makeRepo>;
  let commitmentRepo: ReturnType<typeof makeRepo>;
  let ilrRepo: ReturnType<typeof makeRepo>;
  let evidenceRepo: ReturnType<typeof makeRepo>;
  let qipRepo: ReturnType<typeof makeRepo>;
  let programmeDocRepo: ReturnType<typeof makeRepo>;
  let safeguardingRepo: ReturnType<typeof makeRepo>;
  const storage = { getObjectBuffer: jest.fn() };

  let service: EvidencePackBuilderService;

  beforeEach(async () => {
    otjRepo = makeRepo();
    reviewRepo = makeRepo();
    pdfJobRepo = makeRepo();
    commitmentRepo = makeRepo();
    ilrRepo = makeRepo();
    evidenceRepo = makeRepo();
    qipRepo = makeRepo();
    programmeDocRepo = makeRepo();
    safeguardingRepo = makeRepo();

    const moduleRef = await Test.createTestingModule({
      providers: [
        EvidencePackBuilderService,
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: getRepositoryToken(PdfGenerationJob), useValue: pdfJobRepo },
        {
          provide: getRepositoryToken(CommitmentStatement),
          useValue: commitmentRepo,
        },
        { provide: getRepositoryToken(IlrLearnerRecord), useValue: ilrRepo },
        { provide: getRepositoryToken(KsEvidenceItem), useValue: evidenceRepo },
        { provide: getRepositoryToken(QipAction), useValue: qipRepo },
        {
          provide: getRepositoryToken(ProgrammeDocument),
          useValue: programmeDocRepo,
        },
        {
          provide: getRepositoryToken(SafeguardingChecklistItem),
          useValue: safeguardingRepo,
        },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = moduleRef.get(EvidencePackBuilderService);
    jest.clearAllMocks();
    storage.getObjectBuffer.mockResolvedValue(Buffer.from('file-bytes'));
  });

  it('builds a ZIP with manifest keys for each EIF theme', async () => {
    const { buffer, manifest } = await service.buildZipBuffer('org-1');
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(manifest['behaviour_attitudes']).toBe(1);
    expect(manifest.custom).toBe(0);
  });

  /**
   * F2.1.4 AC1 — "one folder per theme".
   *
   * Archiver only creates a directory when something is written into it, so a
   * theme with no evidence used to vanish from the zip entirely. An inspector
   * opening a pack with four folders cannot tell "considered and empty" from
   * "silently dropped", and the second reading is the damaging one.
   */
  it('gives every EIF theme a folder even when it holds no evidence', async () => {
    const { buffer } = await service.buildZipBuffer('org-1');
    const names = entryNames(buffer);

    for (const slug of getEifCriterionSlugs()) {
      expect(names.some((n) => n.startsWith(`${slug}/`))).toBe(true);
    }
  });

  /**
   * The API response carries a manifest, but an inspector opens this zip
   * offline months later with no API in front of them.
   */
  it('includes a contents page at the root of the zip', async () => {
    const { buffer } = await service.buildZipBuffer('org-1');
    const index = new AdmZip(buffer).getEntry('manifest.json');

    expect(index).toBeTruthy();
    const parsed = JSON.parse(index!.getData().toString()) as {
      themes: Record<string, number>;
    };
    expect(Object.keys(parsed.themes).sort()).toEqual(
      getEifCriterionSlugs().sort(),
    );
  });

  it('states in the empty folder that the theme was not omitted', async () => {
    const { buffer } = await service.buildZipBuffer('org-1');
    const readme = new AdmZip(buffer).getEntry('safeguarding/README.txt');

    expect(readme).toBeTruthy();
    expect(readme!.getData().toString()).toContain('intentionally present');
  });

  /**
   * F2.1.4 AC2 — curriculum intent. These were missing entirely, which is the
   * sharper half: the EIF score for this criterion is computed *from* the
   * programme documents table, so the pack carried a score with none of the
   * evidence that produced it.
   */
  it('includes programme documents under curriculum_intent', async () => {
    programmeDocRepo.find.mockResolvedValue([
      {
        id: 'doc-1',
        programmeId: 'prog-1',
        documentType: 'curriculum_map',
        storageKey: 'orgs/org-1/attachment/doc-1/map.pdf',
        uploadedAt: new Date('2026-01-01'),
      },
    ]);

    const { buffer, manifest } = await service.buildZipBuffer('org-1');

    expect(
      entryNames(buffer).some((n) =>
        n.startsWith('curriculum_intent/programme-documents/'),
      ),
    ).toBe(true);
    expect(manifest['curriculum_intent']).toBe(2); // metadata + file
  });

  /** A storage failure must leave a visible gap, not a quietly shorter pack. */
  it('records a programme document whose file cannot be read', async () => {
    programmeDocRepo.find.mockResolvedValue([
      {
        id: 'doc-1',
        programmeId: 'prog-1',
        documentType: 'curriculum_map',
        storageKey: 'orgs/org-1/attachment/doc-1/map.pdf',
        uploadedAt: new Date('2026-01-01'),
      },
    ]);
    storage.getObjectBuffer.mockRejectedValue(new Error('NoSuchKey'));

    const { buffer, manifest } = await service.buildZipBuffer('org-1');
    const meta = new AdmZip(buffer).getEntry(
      'curriculum_intent/programme-documents/doc-1.json',
    );

    expect(meta).toBeTruthy();
    expect(
      (JSON.parse(meta!.getData().toString()) as { fileIncluded: boolean })
        .fileIncluded,
    ).toBe(false);
    expect(manifest['curriculum_intent']).toBe(1);
  });

  /**
   * F2.1.4 AC2 — safeguarding. Every item, complete or not: a checklist
   * showing only the ticked boxes is not a safeguarding record.
   */
  it('includes the whole safeguarding checklist, incomplete items included', async () => {
    safeguardingRepo.find.mockResolvedValue([
      {
        slug: 'dsl-appointed',
        label: 'DSL appointed',
        completedAt: new Date('2026-01-01'),
        evidenceStorageKey: 'orgs/org-1/attachment/dsl.pdf',
      },
      {
        slug: 'prevent-training',
        label: 'Prevent training',
        completedAt: null,
        evidenceStorageKey: null,
      },
    ]);

    const { buffer } = await service.buildZipBuffer('org-1');
    const list = JSON.parse(
      new AdmZip(buffer)
        .getEntry('safeguarding/safeguarding-checklist.json')!
        .getData()
        .toString(),
    ) as { slug: string; complete: boolean }[];

    expect(list).toHaveLength(2);
    expect(list.find((i) => i.slug === 'prevent-training')?.complete).toBe(
      false,
    );
  });

  /**
   * F2.1.4 AC4 — "completes within 60 seconds for up to 500 learner records".
   *
   * Every object used to be fetched in a sequential `await` loop, so the pack
   * cost roughly `objectCount × latency`. With 500 learners' portfolio
   * evidence at a modest 20ms per object that is 10 seconds of pure waiting
   * for one folder alone, before any of the other five.
   *
   * The simulated latency is what makes this a real assertion rather than a
   * measurement of local CPU: serially this body takes ~10s.
   */
  it('fetches storage objects concurrently, not one at a time (AC4)', async () => {
    const LEARNERS = 500;
    const LATENCY_MS = 20;

    evidenceRepo.find.mockResolvedValue(
      Array.from({ length: LEARNERS }, (_, i) => ({
        id: `ks-${i}`,
        storageKey: `orgs/org-1/attachment/ks-${i}/evidence.pdf`,
      })),
    );

    let inFlight = 0;
    let peakInFlight = 0;
    storage.getObjectBuffer.mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise<void>((r) => {
        setTimeout(r, LATENCY_MS);
      });
      inFlight -= 1;
      return Buffer.from('bytes');
    });

    const startedAt = Date.now();
    const { manifest } = await service.buildZipBuffer('org-1');
    const elapsed = Date.now() - startedAt;

    expect(manifest['curriculum_implementation']).toBe(LEARNERS);
    expect(peakInFlight).toBeGreaterThan(1);
    // Generous bound so this fails on a regression to serial fetching rather
    // than on a slow CI box.
    expect(elapsed).toBeLessThan(5000);
  }, 30000);

  /** Concurrency must stay bounded, or a big pack exhausts the socket pool. */
  it('bounds concurrency rather than opening every socket at once', async () => {
    evidenceRepo.find.mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({
        id: `ks-${i}`,
        storageKey: `orgs/org-1/attachment/ks-${i}/evidence.pdf`,
      })),
    );

    let inFlight = 0;
    let peakInFlight = 0;
    storage.getObjectBuffer.mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise<void>((r) => {
        setTimeout(r, 1);
      });
      inFlight -= 1;
      return Buffer.from('bytes');
    });

    await service.buildZipBuffer('org-1');

    expect(peakInFlight).toBeLessThanOrEqual(16);
  });

  /** F2.1.4 AC5 — custom documents land in their own folder. */
  it('adds custom documents supplied by the provider', async () => {
    const { buffer, manifest } = await service.buildZipBuffer('org-1', [
      'orgs/org-1/attachment/governor-minutes.pdf',
    ]);

    expect(entryNames(buffer)).toContain('custom/governor-minutes.pdf');
    expect(manifest.custom).toBe(1);
  });

  /**
   * A custom document is one the provider explicitly chose to include, so a
   * failure to read it must fail the job loudly rather than hand them a pack
   * silently missing the thing they added. Deliberately different from the
   * platform-sourced files above, which degrade to a metadata stub.
   */
  it('fails the pack when a requested custom document cannot be read', async () => {
    storage.getObjectBuffer.mockRejectedValue(new Error('NoSuchKey'));

    await expect(
      service.buildZipBuffer('org-1', ['orgs/org-1/attachment/missing.pdf']),
    ).rejects.toThrow('NoSuchKey');
  });
});
