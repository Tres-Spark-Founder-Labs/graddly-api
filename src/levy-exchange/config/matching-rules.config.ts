import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type MatchingRuleWeights = {
  sector: number;
  region: number;
  programmeType: number;
  amount: number;
};

export type MatchingAmountBand = {
  minRatio: number;
  score: number;
};

export type MatchingRulesFile = {
  version: number;
  weights: MatchingRuleWeights;
  wildcardScore: number;
  amountBands: MatchingAmountBand[];
  minimumScore: number;
  maxResults: number;
};

const CONFIG_PATH = join(__dirname, 'matching-rules.v1.json');

let cached: MatchingRulesFile | null = null;

export function loadMatchingRulesConfig(): MatchingRulesFile {
  if (!cached) {
    cached = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as MatchingRulesFile;
  }
  return cached;
}
