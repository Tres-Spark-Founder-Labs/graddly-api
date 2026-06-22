import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CommitmentsModule } from '../commitments/commitments.module.js';
import { CommitmentSignature } from '../commitments/entities/commitment-signature.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CompletionPushModule } from '../completion-push/completion-push.module.js';
import { CompletionPushProcessor } from '../completion-push/completion-push.processor.js';
import { DasModule } from '../das/das.module.js';
import { EmailModule } from '../email/email.module.js';
import { EnrolmentPushModule } from '../enrolment-push/enrolment-push.module.js';
import { EnrolmentPushProcessor } from '../enrolment-push/enrolment-push.processor.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { IlrSubmitProcessor } from '../ilr/ilr-submit.processor.js';
import { IlrModule } from '../ilr/ilr.module.js';
import { LevyTransfer } from '../levy-exchange/entities/levy-transfer.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { EvidencePackJob } from '../ofsted/entities/evidence-pack-job.entity.js';
import { OfstedModule } from '../ofsted/ofsted.module.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { EpaPackJob } from '../portfolio/entities/epa-pack-job.entity.js';
import { PortfolioModule } from '../portfolio/portfolio.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';
import { ReviewRecord } from '../reviews/entities/review-record.entity.js';
import { ReviewSignature } from '../reviews/entities/review-signature.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageModule } from '../storage/storage.module.js';
import { WithdrawalPushModule } from '../withdrawal-push/withdrawal-push.module.js';
import { WithdrawalPushProcessor } from '../withdrawal-push/withdrawal-push.processor.js';

import { BullmqModule } from './bullmq.module.js';
import { DasSyncProcessor } from './processors/das-sync.processor.js';
import { DigestProcessor } from './processors/digest.processor.js';
import { EmailSendProcessor } from './processors/email-send.processor.js';
import { EpaPackProcessor } from './processors/epa-pack.processor.js';
import { EvidencePackProcessor } from './processors/evidence-pack.processor.js';
import { PdfGenerationProcessor } from './processors/pdf-generation.processor.js';
import { SystemPingProcessor } from './processors/system-ping.processor.js';

@Module({
  imports: [
    BullmqModule,
    DasModule,
    EmailModule,
    PdfModule,
    StorageModule,
    WithdrawalPushModule,
    NotificationsModule,
    IlrModule,
    EnrolmentsModule,
    EnrolmentPushModule,
    CompletionPushModule,
    OfstedModule,
    PortfolioModule,
    ReportingModule,
    CommitmentsModule,
    TypeOrmModule.forFeature([
      EvidencePackJob,
      EpaPackJob,
      PdfGenerationJob,
      Review,
      ReviewRecord,
      ReviewSignature,
      CommitmentStatement,
      CommitmentSignature,
      LevyTransfer,
      Organisation,
    ]),
  ],
  providers: [
    SystemPingProcessor,
    DasSyncProcessor,
    EmailSendProcessor,
    DigestProcessor,
    PdfGenerationProcessor,
    EvidencePackProcessor,
    EpaPackProcessor,
    WithdrawalPushProcessor,
    IlrSubmitProcessor,
    EnrolmentPushProcessor,
    CompletionPushProcessor,
  ],
})
export class BullmqWorkerModule {}
