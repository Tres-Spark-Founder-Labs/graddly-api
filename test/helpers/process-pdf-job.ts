import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';

import { PdfGenerationProcessor } from '../../src/bullmq/processors/pdf-generation.processor.js';
import { CommitmentAuditTrailService } from '../../src/commitments/commitment-audit-trail.service.js';
import { CommitmentChaseService } from '../../src/commitments/commitment-chase.service.js';
import { CommitmentSignature } from '../../src/commitments/entities/commitment-signature.entity.js';
import { CommitmentStatement } from '../../src/commitments/entities/commitment-statement.entity.js';
import { LevyTransfer } from '../../src/levy-exchange/entities/levy-transfer.entity.js';
import { QipActionsService } from '../../src/ofsted/qip-actions.service.js';
import { Organisation } from '../../src/organisations/entities/organisation.entity.js';
import { PdfGenerationJob } from '../../src/pdf/entities/pdf-generation-job.entity.js';
import { PDF_JOB_GENERATE } from '../../src/pdf/pdf-job.constants.js';
import { PdfService } from '../../src/pdf/pdf.service.js';
import { LevyRoiReportService } from '../../src/reporting/levy-roi-report.service.js';
import { ReviewRecord } from '../../src/reviews/entities/review-record.entity.js';
import { ReviewSignature } from '../../src/reviews/entities/review-signature.entity.js';
import { Review } from '../../src/reviews/entities/review.entity.js';
import { StorageKeyBuilder } from '../../src/storage/storage-key.builder.js';
import { StorageService } from '../../src/storage/storage.service.js';

import type { IPdfJobPayload } from '../../src/pdf/pdf-job.payload.js';
import type { INestApplication } from '@nestjs/common';
import type { Repository } from 'typeorm';

/**
 * Builds the processor by hand because it lives in the worker module, which
 * the e2e application does not boot.
 *
 * **The argument list is positional and unchecked.** ts-jest transpiles
 * without type checking and `tsconfig.build.json` excludes `test/`, so adding
 * a constructor parameter to `PdfGenerationProcessor` and forgetting it here
 * does not fail the build — every argument after the gap silently shifts one
 * place. That happened once already: `commitmentAuditTrailService` was added
 * ahead of the repositories, `jobRepo` received the `Review` repository, and
 * seven e2e suites failed with `invalid input value for enum review_status:
 * "processing"` — the processor updating the wrong table. Keep this list in
 * step with the constructor.
 */
export async function processPdfJobInApp(
  app: INestApplication,
  payload: IPdfJobPayload,
): Promise<void> {
  const processor = new PdfGenerationProcessor(
    app.get(PdfService),
    app.get(StorageService),
    app.get(StorageKeyBuilder),
    app.get(LevyRoiReportService),
    app.get(CommitmentChaseService),
    app.get(CommitmentAuditTrailService),
    app.get(QipActionsService),
    app.get<Repository<PdfGenerationJob>>(getRepositoryToken(PdfGenerationJob)),
    app.get<Repository<Review>>(getRepositoryToken(Review)),
    app.get<Repository<ReviewRecord>>(getRepositoryToken(ReviewRecord)),
    app.get<Repository<ReviewSignature>>(getRepositoryToken(ReviewSignature)),
    app.get<Repository<CommitmentStatement>>(
      getRepositoryToken(CommitmentStatement),
    ),
    app.get<Repository<CommitmentSignature>>(
      getRepositoryToken(CommitmentSignature),
    ),
    app.get<Repository<LevyTransfer>>(getRepositoryToken(LevyTransfer)),
    app.get<Repository<Organisation>>(getRepositoryToken(Organisation)),
  );

  const job = {
    id: payload.jobId,
    name: PDF_JOB_GENERATE,
    data: payload,
  } as Job<IPdfJobPayload>;

  await processor.process(job);
}
