import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { IlrLearnerRecord } from '../ilr/entities/ilr-learner-record.entity.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { Programme } from '../programmes/entities/programme.entity.js';
import { RedisModule } from '../redis/redis.module.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageModule } from '../storage/storage.module.js';
import { User } from '../users/entities/user.entity.js';

import { EifScoreCacheService } from './eif-score-cache.service.js';
import { EifScoreCalculatorService } from './eif-score-calculator.service.js';
import { EifScoreSnapshotService } from './eif-score-snapshot.service.js';
import { EifScoreService } from './eif-score.service.js';
import { EifScoresController } from './eif-scores.controller.js';
import { EifScoreSnapshot } from './entities/eif-score-snapshot.entity.js';
import { EvidencePackJob } from './entities/evidence-pack-job.entity.js';
import { ProgrammeDocument } from './entities/programme-document.entity.js';
import { QipAction } from './entities/qip-action.entity.js';
import { SafeguardingChecklistItem } from './entities/safeguarding-checklist-item.entity.js';
import { EvidencePackBuilderService } from './evidence-pack-builder.service.js';
import { EvidencePackDispatchService } from './evidence-pack-dispatch.service.js';
import { EvidencePackJobsController } from './evidence-pack-jobs.controller.js';
import { EvidencePackJobsService } from './evidence-pack-jobs.service.js';
import { ProgrammeDocumentsController } from './programme-documents.controller.js';
import { ProgrammeDocumentsService } from './programme-documents.service.js';
import { QipActionsController } from './qip-actions.controller.js';
import { QipActionsService } from './qip-actions.service.js';
import { SafeguardingChecklistController } from './safeguarding-checklist.controller.js';
import { SafeguardingChecklistService } from './safeguarding-checklist.service.js';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    RedisModule,
    // F2.1.2 AC5 — the QIP plan export goes through the shared PDF pipeline.
    PdfModule,
    TypeOrmModule.forFeature([
      QipAction,
      EvidencePackJob,
      SafeguardingChecklistItem,
      ProgrammeDocument,
      OrganisationMembership,
      Enrolment,
      OtjLogEntry,
      Review,
      CommitmentStatement,
      IlrLearnerRecord,
      KsEvidenceItem,
      Programme,
      PdfGenerationJob,
      // F2.1.1 — twelve-month EIF trend storage.
      EifScoreSnapshot,
      Organisation,
      // F2.1.2 AC5 — the exported plan names its owners, not their UUIDs.
      User,
    ]),
  ],
  controllers: [
    EifScoresController,
    QipActionsController,
    EvidencePackJobsController,
    SafeguardingChecklistController,
    ProgrammeDocumentsController,
  ],
  providers: [
    EifScoreCacheService,
    EifScoreCalculatorService,
    EifScoreService,
    EifScoreSnapshotService,
    QipActionsService,
    SafeguardingChecklistService,
    ProgrammeDocumentsService,
    EvidencePackDispatchService,
    EvidencePackJobsService,
    EvidencePackBuilderService,
  ],
  exports: [
    EifScoreCacheService,
    EifScoreCalculatorService,
    EifScoreSnapshotService,
    EvidencePackBuilderService,
    EvidencePackDispatchService,
    TypeOrmModule,
  ],
})
export class OfstedModule {}
