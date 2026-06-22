/* eslint-disable @typescript-eslint/naming-convention -- keys mirror eligibility-rules.v1.json status slugs */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type EligibilityFundingBand = {
  min: number;
  max: number;
  currency: string;
};

export type EligibilityRulesFile = {
  version: number;
  eligibleEmployeeBands: string[];
  sectorAllowList: string[];
  regionAllowList: string[];
  fundingBands: {
    default: EligibilityFundingBand;
    bySector: Record<string, EligibilityFundingBand>;
  };
  nextSteps: {
    eligible: string[];
    not_eligible: string[];
    check_with_advisor: string[];
  };
  beginRegistrationPath: string;
};

const CONFIG_PATH = join(__dirname, 'eligibility-rules.v1.json');

let cached: EligibilityRulesFile | null = null;

export function loadEligibilityRulesConfig(): EligibilityRulesFile {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(CONFIG_PATH, 'utf8'),
    ) as EligibilityRulesFile;
  }
  return cached;
}
