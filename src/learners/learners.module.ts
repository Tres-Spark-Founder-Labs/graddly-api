import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { MessageThread } from '../messaging/entities/message-thread.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { ReportingModule } from '../reporting/reporting.module.js';
import { ReviewSignature } from '../reviews/entities/review-signature.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageModule } from '../storage/storage.module.js';
import { User } from '../users/entities/user.entity.js';

import { InterventionAction } from './entities/intervention-action.entity.js';
import { InterventionActionsService } from './intervention-actions.service.js';
import { InterventionQueueService } from './intervention-queue.service.js';
import { LearnerCohortService } from './learner-cohort.service.js';
import { LearnerDocumentsService } from './learner-documents.service.js';
import { LearnerMetricsService } from './learner-metrics.service.js';
import { LearnerProfileService } from './learner-profile.service.js';
import { LearnersController } from './learners.controller.js';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    forwardRef(() => ReportingModule),
    EnrolmentsModule,
    MessagingModule,
    TypeOrmModule.forFeature([
      Enrolment,
      InterventionAction,
      CommitmentStatementGroup,
      CommitmentStatement,
      Review,
      ReviewSignature,
      PdfGenerationJob,
      KsEvidenceItem,
      OtjLogEntry,
      MessageThread,
      Message,
      OrganisationMembership,
      User,
    ]),
  ],
  controllers: [LearnersController],
  providers: [
    LearnerDocumentsService,
    LearnerMetricsService,
    InterventionQueueService,
    InterventionActionsService,
    LearnerCohortService,
    LearnerProfileService,
  ],
  exports: [LearnerDocumentsService, LearnerMetricsService],
})
export class LearnersModule {}
