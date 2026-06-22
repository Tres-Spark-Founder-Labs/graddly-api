import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageModule } from '../storage/storage.module.js';

import { LearnerDocumentsService } from './learner-documents.service.js';
import { LearnersController } from './learners.controller.js';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    TypeOrmModule.forFeature([
      Enrolment,
      CommitmentStatementGroup,
      CommitmentStatement,
      Review,
      PdfGenerationJob,
      KsEvidenceItem,
    ]),
  ],
  controllers: [LearnersController],
  providers: [LearnerDocumentsService],
  exports: [LearnerDocumentsService],
})
export class LearnersModule {}
