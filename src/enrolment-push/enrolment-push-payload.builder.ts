import type { EnrolmentPushTrigger } from './enums/enrolment-push-trigger.enum.js';
import type { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import type { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import type { Organisation } from '../organisations/entities/organisation.entity.js';
import type { Standard } from '../programmes/entities/standard.entity.js';

export interface IEnrolmentPushGraph {
  enrolment: Enrolment;
  apprentice: Apprentice;
  standard: Standard;
  organisation: Organisation;
}

export function buildEnrolmentPushPayload(input: {
  graph: IEnrolmentPushGraph;
  fields: Record<string, unknown>;
  trigger: EnrolmentPushTrigger;
  ilrLearnerRecordId: string;
  ilrSubmissionId?: string | null;
}): Record<string, unknown> {
  const learnerRef =
    pickField(input.fields, 'Learner.LearnRefNumber') ??
    input.graph.enrolment.id;

  return {
    type: 'das_enrolment_submission',
    trigger: input.trigger,
    ukprn: input.graph.organisation.ukprn,
    learnerRef,
    standardCode: input.graph.standard.code,
    givenNames: input.graph.apprentice.firstName,
    familyName: input.graph.apprentice.lastName,
    plannedStartDate: input.graph.enrolment.plannedStartDate,
    plannedEndDate: input.graph.enrolment.plannedEndDate,
    ilrLearnerRecordId: input.ilrLearnerRecordId,
    ilrSubmissionId: input.ilrSubmissionId ?? null,
  };
}

function pickField(
  fields: Record<string, unknown>,
  key: string,
): string | null {
  const value = fields[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
