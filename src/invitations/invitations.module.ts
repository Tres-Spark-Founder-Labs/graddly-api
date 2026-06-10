import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { EnrolmentsModule } from '../enrolments/enrolments.module.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { User } from '../users/entities/user.entity.js';

import { Invitation } from './entities/invitation.entity.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invitation,
      OrganisationMembership,
      Organisation,
      User,
    ]),
    AuthModule,
    EmailModule,
    forwardRef(() => EnrolmentsModule),
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
