import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CommitmentSignature } from '../commitments/entities/commitment-signature.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { DasModule } from '../das/das.module.js';
import { EmailModule } from '../email/email.module.js';
import { EvidencePackJob } from '../ofsted/entities/evidence-pack-job.entity.js';
import { OfstedModule } from '../ofsted/ofsted.module.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfModule } from '../pdf/pdf.module.js';
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
    OfstedModule,
    TypeOrmModule.forFeature([
      EvidencePackJob,
      PdfGenerationJob,
      Review,
      ReviewRecord,
      ReviewSignature,
      CommitmentStatement,
      CommitmentSignature,
    ]),
  ],
  providers: [
    SystemPingProcessor,
    DasSyncProcessor,
    EmailSendProcessor,
    DigestProcessor,
    PdfGenerationProcessor,
    EvidencePackProcessor,
    WithdrawalPushProcessor,
  ],
})
export class BullmqWorkerModule {}
