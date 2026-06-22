import { LevyEligibilityStatus } from '../enums/levy-eligibility-status.enum.js';

import { LevyEligibilityService } from './levy-eligibility.service.js';

describe('LevyEligibilityService', () => {
  let service: LevyEligibilityService;

  beforeEach(() => {
    service = new LevyEligibilityService();
  });

  it('returns eligible for SME band with open sector/region', () => {
    const result = service.check({
      employeeCountBand: '10_49',
      sector: 'construction',
      region: 'north_west',
      hasDasAccount: false,
    });

    expect(result.status).toBe(LevyEligibilityStatus.ELIGIBLE);
    expect(result.beginRegistrationPath).toBe(
      '/api/v1/flowportal-registration/sessions',
    );
    expect(result.estimatedFundingBand.min).toBeGreaterThan(0);
    expect(result.nextSteps.length).toBeGreaterThan(0);
  });

  it('returns not_eligible for levy-paying employer size', () => {
    const result = service.check({
      employeeCountBand: '250_plus',
      sector: 'construction',
      region: 'north_west',
      hasDasAccount: false,
    });

    expect(result.status).toBe(LevyEligibilityStatus.NOT_ELIGIBLE);
    expect(result.beginRegistrationPath).toBeUndefined();
  });

  it('returns check_with_advisor when DAS account exists', () => {
    const result = service.check({
      employeeCountBand: '10_49',
      sector: 'construction',
      region: 'north_west',
      hasDasAccount: true,
    });

    expect(result.status).toBe(LevyEligibilityStatus.CHECK_WITH_ADVISOR);
    expect(result.beginRegistrationPath).toBeUndefined();
  });

  it('uses sector-specific funding band when configured', () => {
    const result = service.check({
      employeeCountBand: '50_249',
      sector: 'digital',
      region: 'london',
      hasDasAccount: false,
    });

    expect(result.estimatedFundingBand.min).toBe(3500);
  });
});
