import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import archiver from 'archiver';
import { In, Repository } from 'typeorm';

import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CommitmentStatementStatus } from '../commitments/enums/commitment-statement-status.enum.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { OtjLogStatus } from '../otj/enums/otj-log-status.enum.js';
import { computeOtjPaceSnapshot } from '../otj/otj-pace-calculator.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfJobStatus } from '../pdf/enums/pdf-job-status.enum.js';
import { Review } from '../reviews/entities/review.entity.js';
import { ReviewStatus } from '../reviews/enums/review-status.enum.js';
import { StorageService } from '../storage/storage.service.js';

import { KsEvidenceItem } from './entities/ks-evidence-item.entity.js';
import { KsEvidenceKsbMapping } from './entities/ks-evidence-ksb-mapping.entity.js';
import { KsEvidenceStatus } from './enums/ks-evidence-status.enum.js';
import { KsEvidenceType } from './enums/ks-evidence-type.enum.js';
import { KsbKind } from './enums/ksb-kind.enum.js';
import { PortfolioHeatmapService } from './portfolio-heatmap.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

export type EpaPackManifest = Record<string, number>;

const KSB_FOLDERS: Record<KsbKind, string> = {
  [KsbKind.KNOWLEDGE]: 'knowledge',
  [KsbKind.SKILL]: 'skill',
  [KsbKind.BEHAVIOUR]: 'behaviour',
};

@Injectable()
export class EpaPackBuilderService {
  constructor(
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(KsEvidenceItem)
    private readonly evidenceRepo: Repository<KsEvidenceItem>,
    @InjectRepository(KsEvidenceKsbMapping)
    private readonly mappingRepo: Repository<KsEvidenceKsbMapping>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(PdfGenerationJob)
    private readonly pdfJobRepo: Repository<PdfGenerationJob>,
    @InjectRepository(CommitmentStatementGroup)
    private readonly commitmentGroupRepo: Repository<CommitmentStatementGroup>,
    @InjectRepository(CommitmentStatement)
    private readonly commitmentRepo: Repository<CommitmentStatement>,
    @InjectRepository(OtjLogEntry)
    private readonly otjRepo: Repository<OtjLogEntry>,
    private readonly heatmapService: PortfolioHeatmapService,
    private readonly storage: StorageService,
  ) {}

  async buildZipBuffer(
    organisationId: string,
    enrolmentId: string,
    userId: string,
  ): Promise<{ buffer: Buffer; manifest: EpaPackManifest }> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, organisationId, isDeleted: false },
    });
    if (!enrolment) {
      throw new Error('Enrolment not found');
    }

    const manifest: EpaPackManifest = {
      knowledge: 0,
      skill: 0,
      behaviour: 0,
      reviews: 0,
      commitment: 0,
      summaries: 0,
    };

    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));

    const done = new Promise<Buffer>((resolve, reject) => {
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
    });

    await this.appendKsbEvidence(
      archive,
      organisationId,
      enrolmentId,
      manifest,
    );
    await this.appendKsbSummary(
      archive,
      organisationId,
      enrolmentId,
      userId,
      manifest,
    );
    await this.appendReviews(archive, organisationId, enrolmentId, manifest);
    await this.appendOtjSummary(
      archive,
      organisationId,
      enrolmentId,
      enrolment,
      manifest,
    );
    await this.appendCommitment(archive, organisationId, enrolmentId, manifest);

    await archive.finalize();
    return { buffer: await done, manifest };
  }

  private async appendKsbEvidence(
    archive: archiver.Archiver,
    organisationId: string,
    enrolmentId: string,
    manifest: EpaPackManifest,
  ): Promise<void> {
    const items = await this.evidenceRepo.find({
      where: {
        organisationId,
        enrolmentId,
        isDeleted: false,
        status: KsEvidenceStatus.ACCEPTED,
      },
    });
    if (items.length === 0) return;

    const itemIds = items.map((i) => i.id);
    const mappings = await this.mappingRepo.find({
      where: { organisationId, evidenceItemId: In(itemIds) },
      relations: ['ksbDefinition'],
    });
    const kindsByItem = new Map<string, Set<KsbKind>>();
    for (const map of mappings) {
      const kind = map.ksbDefinition.kind;
      const set = kindsByItem.get(map.evidenceItemId) ?? new Set();
      set.add(kind);
      kindsByItem.set(map.evidenceItemId, set);
    }

    for (const item of items) {
      const kinds = kindsByItem.get(item.id);
      const folders =
        kinds && kinds.size > 0
          ? [...kinds].map((k) => KSB_FOLDERS[k])
          : ['knowledge'];

      for (const folder of folders) {
        if (item.type === KsEvidenceType.FILE && item.storageKey) {
          const buf = await this.storage.getObjectBuffer(
            organisationId,
            item.storageKey,
          );
          const filename = item.storageKey.split('/').pop() ?? item.id;
          archive.append(buf, { name: `${folder}/${item.id}-${filename}` });
        } else if (item.type === KsEvidenceType.TEXT && item.body) {
          archive.append(item.body, {
            name: `${folder}/${item.id}-statement.txt`,
          });
        } else if (item.type === KsEvidenceType.LINK && item.externalUrl) {
          const content = `${item.title}\n${item.externalUrl}`;
          archive.append(content, {
            name: `${folder}/${item.id}-link.txt`,
          });
        } else if (item.body) {
          archive.append(item.body, {
            name: `${folder}/${item.id}-statement.txt`,
          });
        }
        manifest[folder] = (manifest[folder] ?? 0) + 1;
      }
    }
  }

  private async appendKsbSummary(
    archive: archiver.Archiver,
    organisationId: string,
    enrolmentId: string,
    userId: string,
    manifest: EpaPackManifest,
  ): Promise<void> {
    const heatmap = await this.heatmapService.getHeatmap(
      { id: userId, organisationId, roles: [] } as unknown as AuthenticatedUser,
      enrolmentId,
    );
    archive.append(JSON.stringify(heatmap, null, 2), {
      name: 'ksb-summary.json',
    });
    manifest.summaries = (manifest.summaries ?? 0) + 1;
  }

  private async appendReviews(
    archive: archiver.Archiver,
    organisationId: string,
    enrolmentId: string,
    manifest: EpaPackManifest,
  ): Promise<void> {
    const reviews = await this.reviewRepo.find({
      where: {
        organisationId,
        enrolmentId,
        isDeleted: false,
        status: ReviewStatus.COMPLETED,
      },
      order: { scheduledAt: 'ASC' },
    });

    for (const review of reviews) {
      archive.append(JSON.stringify(review, null, 2), {
        name: `reviews/${review.id}.json`,
      });
      manifest.reviews = (manifest.reviews ?? 0) + 1;

      const pdfKey = await this.resolveReviewPdfKey(organisationId, review);
      if (pdfKey) {
        const buf = await this.storage.getObjectBuffer(organisationId, pdfKey);
        archive.append(buf, { name: `reviews/${review.id}-signed.pdf` });
        manifest.reviews = (manifest.reviews ?? 0) + 1;
      }
    }
  }

  private async appendOtjSummary(
    archive: archiver.Archiver,
    organisationId: string,
    enrolmentId: string,
    enrolment: Enrolment,
    manifest: EpaPackManifest,
  ): Promise<void> {
    const entries = await this.otjRepo.find({
      where: {
        organisationId,
        enrolmentId,
        isDeleted: false,
        status: OtjLogStatus.APPROVED,
      },
    });
    const approvedMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
    const pace = computeOtjPaceSnapshot({
      plannedDurationMonths: enrolment.plannedDurationMonths,
      plannedStartDate: enrolment.plannedStartDate,
      plannedEndDate: enrolment.plannedEndDate,
      activatedAt: enrolment.activatedAt,
      epaDate: enrolment.epaDate,
      approvedMinutes,
    });

    const summary = {
      enrolmentId,
      approvedLogCount: entries.length,
      approvedMinutes,
      pace,
      entries: entries.map((e) => ({
        id: e.id,
        loggedDate: e.loggedDate,
        minutes: e.minutes,
        activityName: e.activityName,
        category: e.category,
        note: e.note,
      })),
    };

    archive.append(JSON.stringify(summary, null, 2), {
      name: 'otj-summary.json',
    });
    manifest.summaries = (manifest.summaries ?? 0) + 1;
  }

  private async appendCommitment(
    archive: archiver.Archiver,
    organisationId: string,
    enrolmentId: string,
    manifest: EpaPackManifest,
  ): Promise<void> {
    const group = await this.commitmentGroupRepo.findOne({
      where: { organisationId, enrolmentId, isDeleted: false },
    });
    if (!group?.currentVersionId) return;

    const statement = await this.commitmentRepo.findOne({
      where: {
        id: group.currentVersionId,
        organisationId,
        status: CommitmentStatementStatus.SIGNED,
      },
    });
    if (!statement) return;

    const pdfKey = await this.resolveCommitmentPdfKey(
      organisationId,
      statement,
    );
    if (!pdfKey) return;

    const buf = await this.storage.getObjectBuffer(organisationId, pdfKey);
    archive.append(buf, {
      name: `commitment/${statement.id}-signed.pdf`,
    });
    manifest.commitment = (manifest.commitment ?? 0) + 1;
  }

  private async resolveReviewPdfKey(
    organisationId: string,
    review: Review,
  ): Promise<string | null> {
    if (review.finalSignedPdfKey) {
      return review.finalSignedPdfKey;
    }
    if (!review.snapshotPdfJobId) return null;
    const pdfJob = await this.pdfJobRepo.findOne({
      where: {
        id: review.snapshotPdfJobId,
        organisationId,
        status: PdfJobStatus.COMPLETED,
      },
    });
    return pdfJob?.outputKey ?? null;
  }

  private async resolveCommitmentPdfKey(
    organisationId: string,
    statement: CommitmentStatement,
  ): Promise<string | null> {
    if (statement.finalSignedPdfKey) {
      return statement.finalSignedPdfKey;
    }
    if (!statement.snapshotPdfJobId) return null;
    const pdfJob = await this.pdfJobRepo.findOne({
      where: { id: statement.snapshotPdfJobId, organisationId },
    });
    return pdfJob?.outputKey ?? null;
  }
}
