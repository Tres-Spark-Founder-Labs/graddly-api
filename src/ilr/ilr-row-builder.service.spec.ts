/* eslint-disable @typescript-eslint/naming-convention -- ILR manual override keys */
import { IlrRowBuilderService } from './ilr-row-builder.service.js';
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
    expect(fields.LearningDelivery.LearnStartDate).toBe('20250115');
    expect(fields.LearningDelivery.ProgType).toBe('25');
    expect(fields.Provider.UKPRN).toBe('10012345');
  });

  it('surfaces empty UKPRN when organisation has none', () => {
    const graph = buildEnrolmentGraphFixture();
    const fields = service.buildFields(minimalMappingConfig, {
      ...graph,
      organisation: { ukprn: null },
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
