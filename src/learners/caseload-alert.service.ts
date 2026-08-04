import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../database/apply-tenant-gucs.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';

import { TutorCaseloadService } from './tutor-caseload.service.js';

/**
 * F2.2.5 AC3 — "programme manager receives alert when any tutor's at-risk
 * count exceeds a configurable threshold (default: 5)".
 */
@Injectable()
export class CaseloadAlertService {
  private readonly logger = new Logger(CaseloadAlertService.name);

  constructor(
    @InjectRepository(Organisation)
    private readonly organisationRepo: Repository<Organisation>,
    @InjectRepository(OrganisationMembership)
    private readonly membershipRepo: Repository<OrganisationMembership>,
    private readonly caseloadService: TutorCaseloadService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Sweep every provider organisation and alert its managers.
   *
   * One organisation failing must not stop the rest — a sweep that aborts
   * halfway silently drops alerts for every provider after the failure, and
   * nobody finds out because the whole point is that the alert never arrived.
   */
  async runSweep(): Promise<{
    organisationsChecked: number;
    alertsSent: number;
  }> {
    const providers = await this.organisationRepo.find({
      where: { portalType: PortalType.PROVIDER, isDeleted: false },
    });

    let alertsSent = 0;
    for (const provider of providers) {
      try {
        alertsSent += await this.alertForOrganisation(provider.id);
      } catch (error) {
        this.logger.error(
          `Caseload alert sweep failed for organisation ${provider.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { organisationsChecked: providers.length, alertsSent };
  }

  private async alertForOrganisation(organisationId: string): Promise<number> {
    const managers = await this.membershipRepo.find({
      where: {
        organisation: { id: organisationId },
        role: In([OrganisationRole.OWNER, OrganisationRole.ADMIN]),
        isDeleted: false,
      },
      relations: ['user'],
    });

    if (managers.length === 0) {
      return 0;
    }

    /**
     * The caseload read runs under this organisation's tenant context.
     *
     * Cron work has no request to inherit GUCs from, so without setting them
     * the row-level security policies see no current organisation and the read
     * returns nothing — the sweep would then cheerfully report zero at-risk
     * tutors everywhere.
     */
    setCurrentOrganisationId(organisationId);
    const actingUserId = managers[0].user.id;
    setCurrentUserId(actingUserId);
    setLastKnownUserIdForGuc(actingUserId);

    const caseload = await this.caseloadService.getCaseload({
      id: actingUserId,
      organisationId,
    } as never);

    const breaching = caseload.tutors.filter(
      (tutor) => tutor.exceedsAtRiskThreshold,
    );
    if (breaching.length === 0) {
      return 0;
    }

    const body = breaching
      .map(
        (tutor) =>
          `${tutor.tutorName}: ${tutor.atRiskCount} at-risk of ${tutor.learnerCount}`,
      )
      .join('; ');

    let sent = 0;
    for (const manager of managers) {
      await this.notificationsService.createForUser({
        userId: manager.user.id,
        organisationId,
        type: NotificationType.CASELOAD_AT_RISK,
        title:
          breaching.length === 1
            ? 'A tutor is over the at-risk caseload threshold'
            : `${breaching.length} tutors are over the at-risk caseload threshold`,
        body: `More than ${caseload.atRiskThreshold} at-risk learners — ${body}.`,
        metadata: {
          threshold: caseload.atRiskThreshold,
          tutors: breaching.map((tutor) => ({
            tutorUserId: tutor.tutorUserId,
            tutorName: tutor.tutorName,
            atRiskCount: tutor.atRiskCount,
          })),
        },
      });
      sent += 1;
    }

    return sent;
  }
}
