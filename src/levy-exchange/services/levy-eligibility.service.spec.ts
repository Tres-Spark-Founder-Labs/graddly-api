import { LevyEligibilityStatus } from '../enums/levy-eligibility-status.enum.js';

import { LevyEligibilityService } from './levy-eligibility.service.js';

describe('LevyEligibilityService', () => {
  let service: LevyEligibilityService;

  beforeEach(() => {
    service = new LevyEligibilityService();
  });

  it('returns eligible for SME band with open sector/region', () => {
    const result = service.check({
      employeeCountBand: '10-49',
      sector: 'Construction',
      region: 'North West',
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
      employeeCountBand: '250+',
      sector: 'Construction',
      region: 'North West',
      hasDasAccount: false,
    });

    expect(result.status).toBe(LevyEligibilityStatus.NOT_ELIGIBLE);
    expect(result.beginRegistrationPath).toBeUndefined();
  });

  it('returns check_with_advisor when DAS account exists', () => {
    const result = service.check({
      employeeCountBand: '10-49',
      sector: 'Construction',
      region: 'North West',
      hasDasAccount: true,
    });

    expect(result.status).toBe(LevyEligibilityStatus.CHECK_WITH_ADVISOR);
    expect(result.beginRegistrationPath).toBeUndefined();
  });

  it('uses sector-specific funding band when configured', () => {
    const result = service.check({
      employeeCountBand: '50-249',
      sector: 'Digital & Technology',
      region: 'London',
      hasDasAccount: false,
    });

    expect(result.estimatedFundingBand.min).toBe(3500);
  });

  it('looks the sector up after the same normalisation as the profile', () => {
    const result = service.check({
      employeeCountBand: '10-49',
      sector: '  Digital   &  Technology ',
      region: 'London',
      hasDasAccount: false,
    });
    expect(result.estimatedFundingBand.min).toBe(3500);
  });

  it('gives a sector with no configured band the default band, not a guess', () => {
    // "Technology" was the checker's old option. It is not the vocabulary's
    // value, and an open field is not mapped onto one.
    const result = service.check({
      employeeCountBand: '10-49',
      sector: 'Technology',
      region: 'London',
      hasDasAccount: false,
    });
    expect(result.estimatedFundingBand.min).toBe(3000);
  });
});
