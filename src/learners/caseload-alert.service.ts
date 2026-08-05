import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  getRlsBootstrap,
  setCurrentOrganisationId,
  setCurrentUserId,
  setRlsBootstrap,
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
    /**
     * Security hardening pass, item 7 — the sweep read needs bootstrap.
     *
     * A cron has no request to inherit GUCs from, so `organisations_select`
     * matched nothing and this returned **zero providers**: the job reported
     * "0 organisations checked" every night and nobody was alerted about any
     * tutor, anywhere. Proven by seed-and-count, not inferred.
     *
     * Scoped to this read alone. `alertForOrganisation` sets per-organisation
     * context below, and that scoping is correct and must not be blanketed.
     */
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    let providers: Organisation[];
    try {
      providers = await this.organisationRepo.find({
        where: { portalType: PortalType.PROVIDER, isDeleted: false },
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }

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
    /**
     * Security hardening pass, item 7 — a SECOND context gap, in the same
     * function, found while fixing the first.
     *
     * This membership read runs *before* `setCurrentOrganisationId` further
     * down, so it had no tenant context either. The comment below correctly
     * explained why the caseload read needs context and, in doing so, made
     * this read look deliberate — it was not. It returned no managers, the
     * function took its `managers.length === 0` early return, and the sweep
     * reported zero alerts without ever reaching the caseload query the
     * comment was about.
     *
     * Bootstrapped rather than org-scoped because of an ordering problem: the
     * acting user id used to set the tenant context is taken *from* this
     * result. Same justification as the commitment-chase signer lookup — a
     * system read to discover who to notify.
     */
    const previousBootstrap = getRlsBootstrap();
    setRlsBootstrap(true);
    let managers: OrganisationMembership[];
    try {
      managers = await this.membershipRepo.find({
        where: {
          organisation: { id: organisationId },
          role: In([OrganisationRole.OWNER, OrganisationRole.ADMIN]),
          isDeleted: false,
        },
        relations: ['user'],
      });
    } finally {
      setRlsBootstrap(previousBootstrap);
    }

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
