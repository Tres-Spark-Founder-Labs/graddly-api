/* eslint-disable @typescript-eslint/naming-convention -- ILR manual override keys */
import { testEntity } from '../common/testing/test-fixture.js';

import {
  IlrRowBuilderService,
  type IlrRowBuildContext,
} from './ilr-row-builder.service.js';
import {
  buildEnrolmentGraphFixture,
  minimalMappingConfig,
} from './testing/ilr-test-fixtures.js';

describe('IlrRowBuilderService', () => {
  const service = new IlrRowBuilderService();

  it('maps domain sources and applies transforms', () => {
    const graph = buildEnrolmentGraphFixture();
    const fields = service.buildFields(minimalMappingConfig, {
      ...graph,
      manualOverrides: { 'Learner.ULN': '1234567890' },
    });

    expect(fields.Learner.FamilyName).toBe('Folio');
    expect(fields.Learner.GivenNames).toBe('Port');
    expect(fields.Learner.ULN).toBe('1234567890');
    expect(fields.Learner.LearnRefNumber).toHaveLength(12);
    expect(fields.LearningDelivery.LearnStartDate).toBe('2025-01-15');
    expect(fields.LearningDelivery.LearnPlanEndDate).toBe('2026-12-31');
    // The programme aim, not the standard's own code (that is StdCode).
    expect(fields.LearningDelivery.LearnAimRef).toBe('ZPROG001');
    expect(fields.LearningDelivery.ProgType).toBe('25');
    expect(fields.Provider.UKPRN).toBe('10012345');
  });

  it('surfaces empty UKPRN when organisation has none', () => {
    const graph = buildEnrolmentGraphFixture();
    const fields = service.buildFields(minimalMappingConfig, {
      ...graph,
      organisation: testEntity<IlrRowBuildContext['organisation']>({
        ukprn: null,
      }),
      manualOverrides: {},
    });

    expect(fields.Provider.UKPRN).toBeNull();
  });

  it('preserves manual overrides on rebuild', () => {
    const graph = buildEnrolmentGraphFixture();
    const overrides = { 'Learner.ULN': '9999999999' };
    const first = service.buildFields(minimalMappingConfig, {
      ...graph,
      manualOverrides: overrides,
    });
    const second = service.buildFields(minimalMappingConfig, {
      ...graph,
      manualOverrides: overrides,
    });

    expect(first.Learner.ULN).toBe('9999999999');
    expect(second.Learner.ULN).toBe('9999999999');
  });
});
