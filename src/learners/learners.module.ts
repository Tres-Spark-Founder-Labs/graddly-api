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
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { KsEvidenceItem } from '../portfolio/entities/ks-evidence-item.entity.js';
import { ReportingModule } from '../reporting/reporting.module.js';
import { ReviewSignature } from '../reviews/entities/review-signature.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { StorageModule } from '../storage/storage.module.js';
import { User } from '../users/entities/user.entity.js';

import { CaseloadAlertService } from './caseload-alert.service.js';
import { InterventionAction } from './entities/intervention-action.entity.js';
import { InterventionActionsService } from './intervention-actions.service.js';
import { InterventionQueueService } from './intervention-queue.service.js';
import { LearnerCohortService } from './learner-cohort.service.js';
import { LearnerDocumentsService } from './learner-documents.service.js';
import { LearnerMeSummaryService } from './learner-me-summary.service.js';
import { LearnerMetricsService } from './learner-metrics.service.js';
import { LearnerProfileService } from './learner-profile.service.js';
import { LearnersController } from './learners.controller.js';
import { TutorCaseloadService } from './tutor-caseload.service.js';

@Module({
  imports: [
    AuthModule,
    StorageModule,
    forwardRef(() => ReportingModule),
    EnrolmentsModule,
    MessagingModule,
    // F2.2.5 AC3 — the caseload alert notifies programme managers.
    NotificationsModule,
    // F2.2.1 AC5 — the cohort PDF goes through the shared job pipeline.
    PdfModule,
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
      // F2.2.1 AC5 — the exported PDF names the provider.
      Organisation,
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
    LearnerMeSummaryService,
    // F2.2.5 — tutor caseload dashboard and bulk assignment.
    TutorCaseloadService,
    CaseloadAlertService,
  ],
  exports: [
    LearnerDocumentsService,
    LearnerMetricsService,
    // F2.2.1 AC5 — consumed by PdfGenerationProcessor in the worker module.
    LearnerCohortService,
    // F2.2.5 AC3 — consumed by the caseload alert cron.
    CaseloadAlertService,
  ],
})
export class LearnersModule {}
