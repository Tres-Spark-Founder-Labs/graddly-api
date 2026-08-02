import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import archiver from 'archiver';
import { In, Repository } from 'typeorm';

import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { KsEvidenceStatus } from '../portfolio/enums/ks-evidence-status.enum.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';
import { StorageService } from '../storage/storage.service.js';

import { loadEifCriteriaConfig } from './eif-criteria.config.js';
import { ProgrammeDocument } from './entities/programme-document.entity.js';
import { QipAction } from './entities/qip-action.entity.js';
import { SafeguardingChecklistItem } from './entities/safeguarding-checklist-item.entity.js';
import { QipActionStatus } from './enums/qip-action-status.enum.js';

export type EvidencePackManifest = Record<string, number>;

/**
 * F2.1.4 AC4 — "completes within 60 seconds for up to 500 learner records".
 *
 * The dominant cost is object-store round trips, not zipping. Fetching them
 * one at a time in an `await` loop meant the pack took roughly
 * `objectCount × latency` — for a provider with 500 learners each holding
 * portfolio evidence, comfortably past the budget on any real network.
 *
 * Bounded rather than unbounded: `Promise.all` over every key at once would
 * open thousands of sockets and trade a slow pack for an exhausted connection
 * pool. Sixteen is enough to hide latency without that.
 */
const STORAGE_FETCH_CONCURRENCY = 16;

/**
 * Fetch in bounded-concurrency batches, preserving input order so archive
 * entry names still line up with their sources.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await fn(items[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

@Injectable()
export class EvidencePackBuilderService {
  constructor(
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(PdfGenerationJob)
    private readonly pdfJobRepo: Repository<PdfGenerationJob>,
    @InjectRepository(CommitmentStatement)
    private readonly commitmentRepo: Repository<CommitmentStatement>,
    @InjectRepository(IlrLearnerRecord)
    private readonly ilrRepo: Repository<IlrLearnerRecord>,
    @InjectRepository(KsEvidenceItem)
    private readonly evidenceRepo: Repository<KsEvidenceItem>,
    @InjectRepository(QipAction)
    private readonly qipRepo: Repository<QipAction>,
    // F2.1.4 AC2 — the two themes that had no evidence source at all.
    @InjectRepository(ProgrammeDocument)
    private readonly programmeDocRepo: Repository<ProgrammeDocument>,
    @InjectRepository(SafeguardingChecklistItem)
    private readonly safeguardingRepo: Repository<SafeguardingChecklistItem>,
    private readonly storage: StorageService,
  ) {}

  async buildZipBuffer(
    organisationId: string,
    additionalStorageKeys: string[] = [],
  ): Promise<{ buffer: Buffer; manifest: EvidencePackManifest }> {
    const manifest: EvidencePackManifest = {};
    const themeFolders = loadEifCriteriaConfig().criteria.map((c) => c.slug);

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<Buffer>((resolve, reject) => {
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });

    for (const theme of themeFolders) {
      manifest[theme] = 0;
    }
    manifest.custom = 0;

    await this.appendOtjCsv(archive, organisationId, manifest);
    await this.appendReviews(archive, organisationId, manifest);
    await this.appendCommitments(archive, organisationId, manifest);
    await this.appendIlrReports(archive, organisationId, manifest);
    await this.appendPortfolioEvidence(archive, organisationId, manifest);
    await this.appendQipEvidence(archive, organisationId, manifest);
    await this.appendProgrammeDocuments(archive, organisationId, manifest);
    await this.appendSafeguardingChecklist(archive, organisationId, manifest);
    await this.appendCustomFiles(
      archive,
      organisationId,
      additionalStorageKeys,
      manifest,
    );

    // AC1 — "one folder per theme". Archiver only creates a directory when
    // something is put in it, so a theme with no evidence previously vanished
    // from the zip entirely. An inspector opening a pack with four folders
    // cannot tell whether the other three themes were considered and empty or
    // silently dropped, and the second reading is the damaging one. Every
    // theme now gets a folder that states which it is.
    this.appendEmptyThemeNotes(archive, themeFolders, manifest);

    // The manifest exists in the API response, but an inspector opens this
    // zip offline, months later, with no API in front of them. A contents
    // page at the root costs nothing and answers "what am I looking at".
    archive.append(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          themes: Object.fromEntries(
            themeFolders.map((theme) => [theme, manifest[theme] ?? 0]),
          ),
          custom: manifest.custom ?? 0,
          note:
            'One folder per Ofsted EIF theme. A folder containing only ' +
            'README.txt means the platform holds no evidence filed against ' +
            'that theme.',
        },
        null,
        2,
      ),
      { name: 'manifest.json' },
    );

    await archive.finalize();
    return { buffer: await done, manifest };
  }

  private appendEmptyThemeNotes(
    archive: archiver.Archiver,
    themeFolders: string[],
    manifest: EvidencePackManifest,
  ): void {
    for (const theme of themeFolders) {
      if ((manifest[theme] ?? 0) > 0) continue;
      archive.append(
        `No evidence has been recorded in Gradlly for this EIF theme.\n\n` +
          `This folder is intentionally present and empty. It does not mean ` +
          `the theme was omitted from the pack — it means the platform holds ` +
          `nothing filed against it. Any evidence held outside Gradlly can be ` +
          `added to the pack as a custom document before download.\n`,
        { name: `${theme}/README.txt` },
      );
    }
  }

  /**
   * F2.1.4 AC2 — curriculum intent.
   *
   * These were missing, which was the sharper half of the gap: the EIF score
   * for `curriculum_intent` is computed *from* this table (see the
   * `programme_docs` metric in the criteria catalogue), so the pack handed to
   * an inspector contained a score for curriculum intent and none of the
   * documents that produced it.
   */
  private async appendProgrammeDocuments(
    archive: archiver.Archiver,
    organisationId: string,
    manifest: EvidencePackManifest,
  ): Promise<void> {
    const theme = 'curriculum_intent';
    const docs = await this.programmeDocRepo.find({
      where: { organisationId, isDeleted: false },
    });
    if (docs.length === 0) return;

    const buffers = await mapWithConcurrency(
      docs,
      STORAGE_FETCH_CONCURRENCY,
      (doc) =>
        this.storage
          .getObjectBuffer(organisationId, doc.storageKey)
          .catch(() => null),
    );

    docs.forEach((doc, i) => {
      const buf = buffers[i];
      // The metadata row is written whether or not the file itself can be
      // read, so a storage failure leaves a visible gap rather than a
      // silently shorter pack.
      archive.append(
        JSON.stringify(
          {
            id: doc.id,
            programmeId: doc.programmeId,
            documentType: doc.documentType,
            uploadedAt: doc.uploadedAt,
            fileIncluded: buf !== null,
          },
          null,
          2,
        ),
        { name: `${theme}/programme-documents/${doc.id}.json` },
      );
      manifest[theme] = (manifest[theme] ?? 0) + 1;

      if (buf) {
        const filename = doc.storageKey.split('/').pop() ?? doc.id;
        archive.append(buf, {
          name: `${theme}/programme-documents/${doc.documentType}-${filename}`,
        });
        manifest[theme] = (manifest[theme] ?? 0) + 1;
      }
    });
  }

  /**
   * F2.1.4 AC2 — safeguarding.
   *
   * The checklist itself is the evidence an inspector asks for first, and it
   * was not in the pack. Every item is included, complete or not: a checklist
   * showing only the ticked boxes is not a safeguarding record, it is a
   * marketing document.
   */
  private async appendSafeguardingChecklist(
    archive: archiver.Archiver,
    organisationId: string,
    manifest: EvidencePackManifest,
  ): Promise<void> {
    const theme = 'safeguarding';
    const items = await this.safeguardingRepo.find({
      where: { organisationId, isDeleted: false },
    });
    if (items.length === 0) return;

    archive.append(
      JSON.stringify(
        items.map((item) => ({
          slug: item.slug,
          label: item.label,
          completedAt: item.completedAt,
          complete: item.completedAt !== null,
          hasEvidence: item.evidenceStorageKey !== null,
        })),
        null,
        2,
      ),
      { name: `${theme}/safeguarding-checklist.json` },
    );
    manifest[theme] = (manifest[theme] ?? 0) + 1;

    const withEvidence = items.filter((item) => item.evidenceStorageKey);
    const buffers = await mapWithConcurrency(
      withEvidence,
      STORAGE_FETCH_CONCURRENCY,
      (item) =>
        this.storage
          .getObjectBuffer(organisationId, item.evidenceStorageKey!)
          .catch(() => null),
    );

    withEvidence.forEach((item, i) => {
      const buf = buffers[i];
      if (!buf) return;
      const filename = item.evidenceStorageKey!.split('/').pop() ?? item.slug;
      archive.append(buf, {
        name: `${theme}/evidence/${item.slug}-${filename}`,
      });
      manifest[theme] = (manifest[theme] ?? 0) + 1;
    });
  }

  private async appendOtjCsv(
    archive: archiver.Archiver,
    organisationId: string,
    manifest: EvidencePackManifest,
  ): Promise<void> {
    const entries = await this.otjRepo.find({
      where: {
        organisationId,
        isDeleted: false,
        status: OtjLogStatus.APPROVED,
      },
      order: { loggedDate: 'ASC' },
    });
    const header = 'id,enrolmentId,apprenticeId,loggedDate,minutes,status\n';
    const rows = entries
      .map(
        (e) =>
          `${e.id},${e.enrolmentId},${e.apprenticeId},${e.loggedDate},${e.minutes},${e.status}`,
      )
      .join('\n');
    const theme = 'behaviour_attitudes';
    archive.append(header + rows, { name: `${theme}/otj-summary.csv` });
    manifest[theme] = (manifest[theme] ?? 0) + 1;
  }

  private async appendReviews(
    archive: archiver.Archiver,
    organisationId: string,
    manifest: EvidencePackManifest,
  ): Promise<void> {
    const theme = 'personal_development';
    const reviews = await this.reviewRepo.find({
      where: {
        organisationId,
        isDeleted: false,
        status: ReviewStatus.COMPLETED,
      },
    });
    for (const review of reviews) {
      archive.append(JSON.stringify(review, null, 2), {
        name: `${theme}/reviews/${review.id}.json`,
      });
      manifest[theme] = (manifest[theme] ?? 0) + 1;
    }

    // AC4. This was one `findOne` per review inside the loop — 500 reviews
    // meant 500 sequential round trips before a single byte was fetched.
    const jobIds = reviews
      .map((r) => r.snapshotPdfJobId)
      .filter((id): id is string => !!id);
    if (jobIds.length === 0) return;

    const pdfJobs = await this.pdfJobRepo.find({
      where: {
        id: In(jobIds),
        organisationId,
        status: PdfJobStatus.COMPLETED,
      },
    });
    const outputKeyByJobId = new Map(
      pdfJobs.filter((j) => j.outputKey).map((j) => [j.id, j.outputKey!]),
    );

    const snapshots = reviews
      .filter(
        (r) => r.snapshotPdfJobId && outputKeyByJobId.has(r.snapshotPdfJobId),
      )
      .map((r) => ({
        reviewId: r.id,
        key: outputKeyByJobId.get(r.snapshotPdfJobId!)!,
      }));

    const buffers = await mapWithConcurrency(
      snapshots,
      STORAGE_FETCH_CONCURRENCY,
      (s) =>
        this.storage.getObjectBuffer(organisationId, s.key).catch(() => null),
    );

    snapshots.forEach((s, i) => {
      const buf = buffers[i];
      if (!buf) return;
      archive.append(buf, {
        name: `${theme}/reviews/${s.reviewId}-snapshot.pdf`,
      });
      manifest[theme] = (manifest[theme] ?? 0) + 1;
    });
  }

  private async appendCommitments(
    archive: archiver.Archiver,
    organisationId: string,
    manifest: EvidencePackManifest,
  ): Promise<void> {
    const theme = 'leadership_management';
    const statements = await this.commitmentRepo.find({
      where: {
        organisationId,
        status: CommitmentStatementStatus.SIGNED,
      },
    });
    for (const statement of statements) {
      const key =
        statement.finalSignedPdfKey ??
        (statement.snapshotPdfJobId
          ? (
              await this.pdfJobRepo.findOne({
                where: { id: statement.snapshotPdfJobId, organisationId },
              })
            )?.outputKey
          : null);
      if (!key) continue;
      const buf = await this.storage.getObjectBuffer(organisationId, key);
      archive.append(buf, {
        name: `${theme}/commitments/${statement.id}.pdf`,
      });
      manifest[theme] = (manifest[theme] ?? 0) + 1;
    }
  }

  private async appendIlrReports(
    archive: archiver.Archiver,
    organisationId: string,
    manifest: EvidencePackManifest,
  ): Promise<void> {
    const theme = 'curriculum_impact';
    const records = await this.ilrRepo.find({
      where: { organisationId, isDeleted: false },
    });
    for (const record of records) {
      archive.append(
        JSON.stringify(
          {
            id: record.id,
            enrolmentId: record.enrolmentId,
            status: record.status,
            fields: record.fields,
            validationSummary: record.validationSummary,
          },
          null,
          2,
        ),
        { name: `${theme}/ilr/${record.id}.json` },
      );
      manifest[theme] = (manifest[theme] ?? 0) + 1;
    }
  }

  private async appendPortfolioEvidence(
    archive: archiver.Archiver,
    organisationId: string,
    manifest: EvidencePackManifest,
  ): Promise<void> {
    const theme = 'curriculum_implementation';
    const items = await this.evidenceRepo.find({
      where: {
        organisationId,
        isDeleted: false,
        status: KsEvidenceStatus.ACCEPTED,
      },
    });
    // AC4 — the heaviest folder in a real pack: one object per accepted
    // piece of portfolio evidence, across every learner.
    const withFile = items.filter((item) => item.storageKey);
    const buffers = await mapWithConcurrency(
      withFile,
      STORAGE_FETCH_CONCURRENCY,
      (item) =>
        this.storage
          .getObjectBuffer(organisationId, item.storageKey!)
          .catch(() => null),
    );

    withFile.forEach((item, i) => {
      const buf = buffers[i];
      if (buf) {
        const filename = item.storageKey!.split('/').pop() ?? item.id;
        archive.append(buf, {
          name: `${theme}/portfolio-evidence/${item.id}-${filename}`,
        });
      } else {
        // Unreadable object: record that it exists rather than dropping it,
        // so the pack cannot quietly under-represent the evidence held.
        archive.append(JSON.stringify(item, null, 2), {
          name: `${theme}/portfolio-evidence/${item.id}.json`,
        });
      }
      manifest[theme] = (manifest[theme] ?? 0) + 1;
    });

    for (const item of items.filter((i) => !i.storageKey)) {
      archive.append(JSON.stringify(item, null, 2), {
        name: `${theme}/portfolio-evidence/${item.id}.json`,
      });
      manifest[theme] = (manifest[theme] ?? 0) + 1;
    }
  }

  private async appendQipEvidence(
    archive: archiver.Archiver,
    organisationId: string,
    manifest: EvidencePackManifest,
  ): Promise<void> {
    const actions = await this.qipRepo.find({
      where: {
        organisationId,
        isDeleted: false,
        status: QipActionStatus.COMPLETED,
      },
    });
    for (const action of actions) {
      const theme = action.eifCriterionSlug;
      if (!manifest[theme] && theme !== 'custom') manifest[theme] = 0;
      archive.append(JSON.stringify(action, null, 2), {
        name: `${theme}/qip-evidence/${action.id}.json`,
      });
      manifest[theme] = (manifest[theme] ?? 0) + 1;
    }

    // Flattened across actions before fetching, so one action with twelve
    // attachments does not serialise behind another with one. (F2.1.2 made
    // multiple attachments per action possible, which made this matter.)
    const attachments = actions.flatMap((action) =>
      (action.evidenceAttachmentKeys ?? []).map((key) => ({
        theme: action.eifCriterionSlug,
        actionId: action.id,
        key,
      })),
    );
    const buffers = await mapWithConcurrency(
      attachments,
      STORAGE_FETCH_CONCURRENCY,
      (a) =>
        this.storage.getObjectBuffer(organisationId, a.key).catch(() => null),
    );

    attachments.forEach((a, i) => {
      const buf = buffers[i];
      if (!buf) return;
      const filename = a.key.split('/').pop() ?? a.actionId;
      archive.append(buf, {
        name: `${a.theme}/qip-evidence/${a.actionId}-${filename}`,
      });
      manifest[a.theme] = (manifest[a.theme] ?? 0) + 1;
    });
  }

  private async appendCustomFiles(
    archive: archiver.Archiver,
    organisationId: string,
    keys: string[],
    manifest: EvidencePackManifest,
  ): Promise<void> {
    const buffers = await mapWithConcurrency(
      keys,
      STORAGE_FETCH_CONCURRENCY,
      (key) => this.storage.getObjectBuffer(organisationId, key),
    );

    keys.forEach((key, i) => {
      const filename = key.split('/').pop() ?? 'file';
      archive.append(buffers[i], { name: `custom/${filename}` });
      manifest.custom = (manifest.custom ?? 0) + 1;
    });
  }
}
