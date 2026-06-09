import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { Programme } from '../programmes/entities/programme.entity.js';
import { RedisModule } from '../redis/redis.module.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageModule } from '../storage/storage.module.js';

import { EifScoreCacheService } from './eif-score-cache.service.js';
import { EifScoreCalculatorService } from './eif-score-calculator.service.js';
import { EifScoreService } from './eif-score.service.js';
import { EifScoresController } from './eif-scores.controller.js';
import { EvidencePackJob } from './entities/evidence-pack-job.entity.js';
import { QipAction } from './entities/qip-action.entity.js';
import { EvidencePackBuilderService } from './evidence-pack-builder.service.js';
import { EvidencePackDispatchService } from './evidence-pack-dispatch.service.js';
import { EvidencePackJobsController } from './evidence-pack-jobs.controller.js';
import { EvidencePackJobsService } from './evidence-pack-jobs.service.js';
import { QipActionsController } from './qip-actions.controller.js';
import { QipActionsService } from './qip-actions.service.js';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    RedisModule,
    TypeOrmModule.forFeature([
      QipAction,
      EvidencePackJob,
      OrganisationMembership,
      Enrolment,
      OtjLogEntry,
      Review,
      CommitmentStatement,
      IlrLearnerRecord,
      KsEvidenceItem,
      Programme,
      PdfGenerationJob,
    ]),
  ],
  controllers: [
    EifScoresController,
    QipActionsController,
    EvidencePackJobsController,
  ],
  providers: [
    EifScoreCacheService,
    EifScoreCalculatorService,
    EifScoreService,
    QipActionsService,
    EvidencePackDispatchService,
    EvidencePackJobsService,
    EvidencePackBuilderService,
  ],
  exports: [
    EifScoreCacheService,
    EvidencePackBuilderService,
    EvidencePackDispatchService,
    TypeOrmModule,
  ],
})
export class OfstedModule {}
