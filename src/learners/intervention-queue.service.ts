import { Injectable } from '@nestjs/common';

import { PortalType } from '../organisations/portal-type.enum.js';
import { ReportingPortalService } from '../reporting/reporting-portal.service.js';

import {
  InterventionQueueEntryResponseDto,
  InterventionQueueResponseDto,
} from './dto/learner-provider-response.dto.js';
import { ListInterventionQueueQueryDto } from './dto/list-learner-cohort-query.dto.js';
import { LearnerMetricsService } from './learner-metrics.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class InterventionQueueService {
  constructor(
    private readonly portalService: ReportingPortalService,
    private readonly metricsService: LearnerMetricsService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListInterventionQueueQueryDto,
  ): Promise<InterventionQueueResponseDto> {
    const organisationId = user.organisationId!;
    await this.portalService.assertPortalType(
      organisationId,
      PortalType.PROVIDER,
    );

    const tutorFilter = query.mine ? user.id : query.tutorUserId;

    const enrolments =
      await this.metricsService.loadActiveEnrolments(organisationId);
    const filtered =
      tutorFilter !== undefined
        ? enrolments.filter((e) => e.tutorUserId === tutorFilter)
        : enrolments;

    const contexts = await Promise.all(
      filtered.map((enrolment) =>
        this.metricsService.buildContext(enrolment, organisationId),
      ),
    );

    const atRisk = contexts.filter((ctx) => ctx.severityScore > 0);
    const employerIds = [
      ...new Set(
        atRisk
          .map((ctx) => ctx.enrolment.employerOrganisationId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const tutorIds = [
      ...new Set(
        atRisk
          .map((ctx) => ctx.enrolment.tutorUserId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const [employerContacts, tutorNames] = await Promise.all([
      this.metricsService.loadEmployerContacts(employerIds),
      this.metricsService.loadTutorNames(tutorIds),
    ]);

    const items: InterventionQueueEntryResponseDto[] = atRisk
      .sort((a, b) => {
        if (b.severityScore !== a.severityScore) {
          return b.severityScore - a.severityScore;
        }
        return b.daysSinceLastActivity - a.daysSinceLastActivity;
      })
      .map((ctx) => {
        const enrolment = ctx.enrolment;
        const apprentice = enrolment.apprentice;
        const employerId = enrolment.employerOrganisationId;
        const employerContact = employerId
          ? employerContacts.get(employerId)
          : undefined;

        return {
          enrolmentId: enrolment.id,
          learnerName: `${apprentice.firstName} ${apprentice.lastName}`.trim(),
          flagReasons: ctx.flagReasons,
          severityScore: ctx.severityScore,
          daysSinceLastActivity: ctx.daysSinceLastActivity,
          tutorUserId: enrolment.tutorUserId,
          tutorName: enrolment.tutorUserId
            ? (tutorNames.get(enrolment.tutorUserId) ?? null)
            : null,
          employerName: enrolment.employerOrganisation?.name ?? null,
          employerContactName: employerContact?.contactName ?? null,
          employerContactEmail: employerContact?.contactEmail ?? null,
        };
      });

    return {
      items,
      atRiskCount: items.length,
    };
  }
}
