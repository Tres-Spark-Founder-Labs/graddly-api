import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type EifCriterionConfig = {
  slug: string;
  label: string;
  metric: string;
};

export type EifCriteriaFile = {
  version: number;
  criteria: EifCriterionConfig[];
};

const CONFIG_PATH = join(__dirname, 'config', 'eif-criteria.v1.json');

let cached: EifCriteriaFile | null = null;

export function loadEifCriteriaConfig(): EifCriteriaFile {
  if (!cached) {
    cached = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as EifCriteriaFile;
  }
  return cached;
}

export function getEifCriterionSlugs(): string[] {
  return loadEifCriteriaConfig().criteria.map((c) => c.slug);
}

export function assertEifCriterionSlug(slug: string): void {
  if (!getEifCriterionSlugs().includes(slug)) {
    throw new Error(`Unknown EIF criterion slug: ${slug}`);
  }
}
