import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import archiver from 'archiver';
import { Repository } from 'typeorm';

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
import { QipAction } from './entities/qip-action.entity.js';
import { QipActionStatus } from './enums/qip-action-status.enum.js';

export type EvidencePackManifest = Record<string, number>;

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
    await this.appendCustomFiles(
      archive,
      organisationId,
      additionalStorageKeys,
      manifest,
    );

    await archive.finalize();
    return { buffer: await done, manifest };
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
      if (review.snapshotPdfJobId) {
        const pdfJob = await this.pdfJobRepo.findOne({
          where: {
            id: review.snapshotPdfJobId,
            organisationId,
            status: PdfJobStatus.COMPLETED,
          },
        });
        if (pdfJob?.outputKey) {
          const buf = await this.storage.getObjectBuffer(
            organisationId,
            pdfJob.outputKey,
          );
          archive.append(buf, {
            name: `${theme}/reviews/${review.id}-snapshot.pdf`,
          });
          manifest[theme] = (manifest[theme] ?? 0) + 1;
        }
      }
    }
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
    for (const item of items) {
      if (item.storageKey) {
        const buf = await this.storage.getObjectBuffer(
          organisationId,
          item.storageKey,
        );
        const filename = item.storageKey.split('/').pop() ?? item.id;
        archive.append(buf, {
          name: `${theme}/portfolio-evidence/${item.id}-${filename}`,
        });
        manifest[theme] = (manifest[theme] ?? 0) + 1;
      } else {
        archive.append(JSON.stringify(item, null, 2), {
          name: `${theme}/portfolio-evidence/${item.id}.json`,
        });
        manifest[theme] = (manifest[theme] ?? 0) + 1;
      }
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
      for (const key of action.evidenceAttachmentKeys ?? []) {
        const buf = await this.storage.getObjectBuffer(organisationId, key);
        const filename = key.split('/').pop() ?? action.id;
        archive.append(buf, {
          name: `${theme}/qip-evidence/${action.id}-${filename}`,
        });
        manifest[theme] = (manifest[theme] ?? 0) + 1;
      }
    }
  }

  private async appendCustomFiles(
    archive: archiver.Archiver,
    organisationId: string,
    keys: string[],
    manifest: EvidencePackManifest,
  ): Promise<void> {
    for (const key of keys) {
      const buf = await this.storage.getObjectBuffer(organisationId, key);
      const filename = key.split('/').pop() ?? 'file';
      archive.append(buf, { name: `custom/${filename}` });
      manifest.custom = (manifest.custom ?? 0) + 1;
    }
  }
}
