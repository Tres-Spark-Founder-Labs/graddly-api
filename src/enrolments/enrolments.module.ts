import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { AuthModule } from '../auth/auth.module.js';
import { CompletionPushModule } from '../completion-push/completion-push.module.js';
import { InvitationsModule } from '../invitations/invitations.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { Standard } from '../programmes/entities/standard.entity.js';
import { UsersModule } from '../users/users.module.js';
import { WithdrawalPushModule } from '../withdrawal-push/withdrawal-push.module.js';

import { EnrolmentPipelineService } from './enrolment-pipeline.service.js';
import { EnrolmentProvisioningService } from './enrolment-provisioning.service.js';
import { EnrolmentsController } from './enrolments.controller.js';
import { EnrolmentsService } from './enrolments.service.js';
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
    ]),
  ],
  controllers: [EnrolmentsController],
  providers: [
    EnrolmentsService,
    EnrolmentPipelineService,
    EnrolmentProvisioningService,
  ],
  exports: [
    TypeOrmModule,
    EnrolmentsService,
    EnrolmentPipelineService,
    EnrolmentProvisioningService,
  ],
})
export class EnrolmentsModule {}
