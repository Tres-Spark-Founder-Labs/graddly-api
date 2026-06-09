import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type OtjActivityCategoryConfig = {
  slug: string;
  label: string;
};

export type OtjActivityCategoriesFile = {
  version: number;
  categories: OtjActivityCategoryConfig[];
};

const CONFIG_PATH = join(
  __dirname,
  'config',
  'otj-activity-categories.v1.json',
);

let cached: OtjActivityCategoriesFile | null = null;

export function loadOtjActivityCategoriesConfig(): OtjActivityCategoriesFile {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(CONFIG_PATH, 'utf8'),
    ) as OtjActivityCategoriesFile;
  }
  return cached;
}
