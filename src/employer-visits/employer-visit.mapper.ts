import { EmployerVisitResponseDto } from './dto/employer-visit-response.dto.js';
import { EmployerVisitLearner } from './entities/employer-visit-learner.entity.js';
import { EmployerVisit } from './entities/employer-visit.entity.js';

/**
 * Shared by the create, list and detail routes so all three describe a visit
 * identically. Three hand-written mappings is how a field ends up present on
 * one route and quietly missing from another.
 */
export function toEmployerVisitResponse(
  visit: EmployerVisit,
  learners: EmployerVisitLearner[],
): EmployerVisitResponseDto {
  return {
    id: visit.id,
    employerOrganisationId: visit.employerOrganisationId,
    employerName: visit.employerOrganisation?.name ?? null,
    visitedOn: visit.visitedOn,
    visitType: visit.visitType,
    attendees: visit.attendees,
    discussionPoints: visit.discussionPoints,
    actionPoints: visit.actionPoints,
    nextVisitDate: visit.nextVisitDate,
    learners: learners.map((link) => ({
      enrolmentId: link.enrolmentId,
      apprenticeName: link.enrolment?.apprentice
        ? `${link.enrolment.apprentice.firstName} ${link.enrolment.apprentice.lastName}`.trim()
        : '',
    })),
    recordedByUserId: visit.recordedByUserId,
    createdAt: visit.createdAt.toISOString(),
  };
}
