/* eslint-disable @typescript-eslint/naming-convention -- ILR ESFA field and entity names */
import { IlrLearnerRecordStatus } from '../enums/ilr-learner-record-status.enum.js';

import type {
  IlrFieldMap,
  IlrMappingConfigDocument,
} from '../types/ilr-mapping-config.types.js';

export const minimalMappingConfig: IlrMappingConfigDocument = {
  academicYear: '2025-26',
  entities: {
    Learner: {
      LearnRefNumber: {
        source: 'enrolment.id',
        transform: 'ilrRef',
        required: true,
      },
      FamilyName: { source: 'apprentice.lastName', required: true },
      GivenNames: { source: 'apprentice.firstName', required: true },
      ULN: { source: 'manual', required: false },
    },
    LearningDelivery: {
      LearnAimRef: { source: 'standard.code', required: true },
      LearnStartDate: {
        source: 'enrolment.plannedStartDate',
        transform: 'ilrDate',
        required: true,
      },
      LearnPlanEndDate: {
        source: 'enrolment.plannedEndDate',
        transform: 'ilrDate',
        required: false,
      },
      ProgType: { source: 'constant', value: '25', required: true },
    },
    Provider: {
      UKPRN: { source: 'organisation.ukprn', required: true },
    },
  },
  rules: [
    {
      code: 'ILR001',
      severity: 'error',
      field: 'Provider.UKPRN',
      type: 'required',
      message: 'Provider UKPRN is required for ILR submission.',
    },
    {
      code: 'ILR002',
      severity: 'error',
      field: 'LearningDelivery.LearnStartDate',
      type: 'dateNotAfter',
      otherField: 'LearningDelivery.LearnPlanEndDate',
      message: 'Start date must be on or before planned end date.',
    },
  ],
};

export function buildSampleFieldMap(): IlrFieldMap {
  return {
    Learner: {
      LearnRefNumber: 'ABC123456789',
      FamilyName: 'Folio',
      GivenNames: 'Port',
      ULN: null,
    },
    LearningDelivery: {
      LearnAimRef: 'ST0001',
      LearnStartDate: '20250101',
      LearnPlanEndDate: '20261231',
      ProgType: '25',
    },
    Provider: {
      UKPRN: '10012345',
    },
  };
}

export function buildEnrolmentGraphFixture() {
  return {
    enrolment: {
      id: '11111111-1111-1111-1111-111111111111',
      plannedStartDate: '2025-01-15',
      plannedEndDate: '2026-12-31',
    },
    apprentice: {
      firstName: 'Port',
      lastName: 'Folio',
    },
    standard: {
      code: 'ST0001',
    },
    organisation: {
      ukprn: '10012345',
    },
  };
}

export function buildLearnerRecordFixture(
  overrides: Partial<{
    id: string;
    status: IlrLearnerRecordStatus;
    fields: IlrFieldMap;
    manualOverrides: Record<string, string>;
  }> = {},
) {
  return {
    id: overrides.id ?? '22222222-2222-2222-2222-222222222222',
    organisationId: '33333333-3333-3333-3333-333333333333',
    enrolmentId: '11111111-1111-1111-1111-111111111111',
    apprenticeId: '44444444-4444-4444-4444-444444444444',
    collectionPeriod: '2025-10',
    academicYear: '2025-26',
    mappingConfigId: '55555555-5555-5555-5555-555555555555',
    mappingConfigVersion: 1,
    fields: overrides.fields ?? buildSampleFieldMap(),
    manualOverrides: overrides.manualOverrides ?? {},
    status: overrides.status ?? IlrLearnerRecordStatus.DRAFT,
    lastValidatedAt: null,
    validationSummary: null,
    createdAt: new Date('2025-10-01T00:00:00.000Z'),
    updatedAt: new Date('2025-10-01T00:00:00.000Z'),
    isDeleted: false,
    deletedAt: null,
  };
}
