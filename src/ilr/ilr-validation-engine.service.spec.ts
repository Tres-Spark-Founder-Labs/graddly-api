import { IlrValidationEngine } from './ilr-validation-engine.service.js';
import {
  buildSampleFieldMap,
  minimalMappingConfig,
} from './testing/ilr-test-fixtures.js';

describe('IlrValidationEngine', () => {
  const engine = new IlrValidationEngine();

  it('passes a clean record', () => {
    const report = engine.validate(minimalMappingConfig, buildSampleFieldMap());
    expect(report.isValid).toBe(true);
    expect(report.summary.errorCount).toBe(0);
  });

  it('reports required field errors in plain English', () => {
    const fields = buildSampleFieldMap();
    fields.Provider.UKPRN = null;
    const report = engine.validate(minimalMappingConfig, fields);

    expect(report.isValid).toBe(false);
    expect(report.issues.some((i) => i.field === 'Provider.UKPRN')).toBe(true);
    expect(
      report.issues.some((i) => i.message.includes('Provider.UKPRN')),
    ).toBe(true);
  });

  it('applies ILR002 dateNotAfter rule message', () => {
    const fields = buildSampleFieldMap();
    fields.LearningDelivery.LearnStartDate = '20270101';
    fields.LearningDelivery.LearnPlanEndDate = '20260101';
    const report = engine.validate(minimalMappingConfig, fields);

    const ilr002 = report.issues.find((i) => i.code === 'ILR002');
    expect(ilr002?.message).toBe(
      'Start date must be on or before planned end date.',
    );
  });
});
