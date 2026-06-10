import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InvitationsService } from '../invitations/invitations.service.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { MembershipStatus } from '../organisations/membership-status.enum.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { UsersService } from '../users/users.service.js';

import { EnrolmentPipelineService } from './enrolment-pipeline.service.js';
import { Enrolment } from './entities/enrolment.entity.js';
import { EnrolmentPipelineState } from './enums/enrolment-pipeline-state.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { Invitation } from '../invitations/entities/invitation.entity.js';

@Injectable()
export class EnrolmentProvisioningService {
  private readonly logger = new Logger(EnrolmentProvisioningService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly pipelineService: EnrolmentPipelineService,
    @Inject(forwardRef(() => InvitationsService))
    private readonly invitationsService: InvitationsService,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
  ) {}

  async onActivate(
    enrolment: Enrolment,
    actor: AuthenticatedUser,
  ): Promise<Enrolment> {
    const autoInvite = this.config.get<boolean>(
      'app.enrolment.autoInviteApprentice',
      true,
    );
    if (!autoInvite) {
      return enrolment;
    }

    const apprentice = enrolment.apprentice;
    if (!apprentice?.email) {
      const loaded = await this.enrolmentRepo.findOne({
        where: { id: enrolment.id },
        relations: ['apprentice'],
      });
      if (!loaded?.apprentice?.email) {
        this.logger.warn(
          `Skipping apprentice invite for enrolment ${enrolment.id}: no apprentice email`,
        );
        return enrolment;
      }
      enrolment.apprentice = loaded.apprentice;
    }

    const email = enrolment.apprentice.email.trim();
    const existingUser = await this.usersService.findByEmail(email);

    let updated = enrolment;
    if (existingUser) {
      if (!enrolment.apprenticeUserId) {
        enrolment.apprenticeUserId = existingUser.id;
        updated = await this.enrolmentRepo.save(enrolment);
      }
      await this.pipelineService.advanceIfAhead(
        enrolment.id,
        EnrolmentPipelineState.ACCOUNT_CREATED,
      );
    } else {
      const inviteOrgId = enrolment.organisationId;
      await this.invitationsService.createForEnrolment({
        actor,
        email,
        organisationId: inviteOrgId,
        enrolmentId: enrolment.id,
        portalType: PortalType.APPRENTICE,
      });
      const advanced = await this.pipelineService.advanceIfAhead(
        enrolment.id,
        EnrolmentPipelineState.INVITED,
      );
      if (advanced) {
        updated = advanced;
      }
    }

    await this.notifyProviderPendingAcceptance(enrolment);
    return updated;
  }

  async onInvitationAccepted(
    invitation: Invitation,
    userId: string,
  ): Promise<void> {
    if (!invitation.enrolmentId) {
      return;
    }

    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: invitation.enrolmentId, isDeleted: false },
    });
    if (!enrolment) {
      return;
    }

    if (!enrolment.apprenticeUserId) {
      enrolment.apprenticeUserId = userId;
      await this.enrolmentRepo.save(enrolment);
    }

    await this.pipelineService.advanceIfAhead(
      enrolment.id,
      EnrolmentPipelineState.ACCOUNT_CREATED,
    );
  }

  private async notifyProviderPendingAcceptance(
    enrolment: Enrolment,
  ): Promise<void> {
    const providerOrgId =
      enrolment.providerOrganisationId ?? enrolment.organisationId;
    const memberships = await this.membershipRepo.find({
      where: {
        organisation: { id: providerOrgId },
        isDeleted: false,
        status: MembershipStatus.ACTIVE,
        role: OrganisationRole.OWNER,
      },
      relations: ['user'],
    });
    const admins = await this.membershipRepo.find({
      where: {
        organisation: { id: providerOrgId },
        isDeleted: false,
        status: MembershipStatus.ACTIVE,
        role: OrganisationRole.ADMIN,
      },
      relations: ['user'],
    });

    const recipients = [...memberships, ...admins];
    const notified = new Set<string>();
    for (const membership of recipients) {
      const userId = membership.user.id;
      if (notified.has(userId)) {
        continue;
      }
      notified.add(userId);
      await this.notificationsService.createForUser({
        userId,
        organisationId: providerOrgId,
        type: NotificationType.GENERIC,
        title: 'Enrolment pending provider acceptance',
        body: 'A new enrolment has been activated and is awaiting provider acceptance.',
        metadata: {
          enrolmentId: enrolment.id,
          action: 'pending_provider_accept',
        },
      });
    }
  }
}
