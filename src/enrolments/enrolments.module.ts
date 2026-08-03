import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommitmentStatementGroup } from '../commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../commitments/entities/commitment-statement.entity.js';
import { CompletionPushModule } from '../completion-push/completion-push.module.js';
import { InvitationsModule } from '../invitations/invitations.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { Review } from '../reviews/entities/review.entity.js';
import { User } from '../users/entities/user.entity.js';
import { UsersModule } from '../users/users.module.js';
import { WithdrawalPushModule } from '../withdrawal-push/withdrawal-push.module.js';

import { BreakInLearningService } from './break-in-learning.service.js';
import { EnrolmentJourneyService } from './enrolment-journey.service.js';
import { EnrolmentPipelineService } from './enrolment-pipeline.service.js';
import { EnrolmentProvisioningService } from './enrolment-provisioning.service.js';
import { EnrolmentsController } from './enrolments.controller.js';
import { EnrolmentsService } from './enrolments.service.js';
import { BreakInLearning } from './entities/break-in-learning.entity.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EpaOutcomeRecord } from './entities/epa-outcome.entity.js';

@Module({
  imports: [
    AuthModule,
    WithdrawalPushModule,
    CompletionPushModule,
    NotificationsModule,
    UsersModule,
    forwardRef(() => InvitationsModule),
    forwardRef(() => MessagingModule),
    TypeOrmModule.forFeature([
      Enrolment,
      EpaOutcomeRecord,
      Apprentice,
      Standard,
      Organisation,
      OrganisationMembership,
      User,
      OtjLogEntry,
      CommitmentStatementGroup,
      CommitmentStatement,
      Review,
      // F2.2.4 AC6 — break-in-learning history.
      BreakInLearning,
    ]),
  ],
  controllers: [EnrolmentsController],
  providers: [
    EnrolmentsService,
    EnrolmentJourneyService,
    EnrolmentPipelineService,
    EnrolmentProvisioningService,
    BreakInLearningService,
  ],
  exports: [
    TypeOrmModule,
    EnrolmentsService,
    EnrolmentJourneyService,
    EnrolmentPipelineService,
    EnrolmentProvisioningService,
    // F2.2.4 AC6 — the learner profile reads the open break.
    BreakInLearningService,
  ],
})
export class EnrolmentsModule {}
