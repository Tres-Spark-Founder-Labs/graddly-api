import { Injectable } from '@nestjs/common';

import {
  loadEligibilityRulesConfig,
  type EligibilityFundingBand,
} from '../config/eligibility-rules.config.js';
import { LevyEligibilityStatus } from '../enums/levy-eligibility-status.enum.js';

import type { CheckLevyEligibilityDto } from '../dto/check-levy-eligibility.dto.js';
import type { LevyEligibilityResponseDto } from '../dto/levy-eligibility-response.dto.js';

@Injectable()
export class LevyEligibilityService {
  check(input: CheckLevyEligibilityDto): LevyEligibilityResponseDto {
    const rules = loadEligibilityRulesConfig();

    if (input.hasDasAccount) {
      return this.buildResponse(
        LevyEligibilityStatus.CHECK_WITH_ADVISOR,
        input.sector,
        rules,
      );
    }

    if (!this.isAllowedSlug(input.sector, rules.sectorAllowList)) {
      return this.buildResponse(
        LevyEligibilityStatus.NOT_ELIGIBLE,
        input.sector,
        rules,
      );
    }

    if (!this.isAllowedSlug(input.region, rules.regionAllowList)) {
      return this.buildResponse(
        LevyEligibilityStatus.NOT_ELIGIBLE,
        input.sector,
        rules,
      );
    }

    if (!rules.eligibleEmployeeBands.includes(input.employeeCountBand)) {
      return this.buildResponse(
        LevyEligibilityStatus.NOT_ELIGIBLE,
        input.sector,
        rules,
      );
    }

    return this.buildResponse(
      LevyEligibilityStatus.ELIGIBLE,
      input.sector,
      rules,
    );
  }

  private isAllowedSlug(value: string, allowList: string[]): boolean {
    if (allowList.includes('*')) {
      return true;
    }
    return allowList.includes(value);
  }

  private resolveFundingBand(
    sector: string,
    rules: ReturnType<typeof loadEligibilityRulesConfig>,
  ): EligibilityFundingBand {
    return rules.fundingBands.bySector[sector] ?? rules.fundingBands.default;
  }

  private buildResponse(
    status: LevyEligibilityStatus,
    sector: string,
    rules: ReturnType<typeof loadEligibilityRulesConfig>,
  ): LevyEligibilityResponseDto {
    const nextStepsKey =
      status === LevyEligibilityStatus.ELIGIBLE
        ? 'eligible'
        : status === LevyEligibilityStatus.CHECK_WITH_ADVISOR
          ? 'check_with_advisor'
          : 'not_eligible';

    const response: LevyEligibilityResponseDto = {
      status,
      estimatedFundingBand: this.resolveFundingBand(sector, rules),
      nextSteps: [...rules.nextSteps[nextStepsKey]],
    };

    if (status === LevyEligibilityStatus.ELIGIBLE) {
      response.beginRegistrationPath = rules.beginRegistrationPath;
    }

    return response;
  }
}
