import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { OtjActivityCategory } from './enums/otj-activity-category.enum.js';

/**
 * F3.1.1 AC2 — the apprentice app's category dropdown must not drift from this
 * enum.
 *
 * The apprentice quick-log form holds its six options locally rather than
 * fetching the catalogue, because a round trip inside AC5's 30-second budget is
 * a round trip inside the thing being measured. That trade is only safe if
 * something notices when the two lists diverge.
 *
 * This is the F1.2.4 failure guarded at the source: there, the UI recognised
 * `overdue` while the API had started sending `off_track`, and the mismatch
 * surfaced as a neutral grey "Unknown" badge on the platform's most at-risk
 * apprentices — a wrong answer that looked like a data-quality nitpick.
 *
 * The test reads the frontend constant as text rather than importing it,
 * because the two live in separate repositories with no build-time link. If the
 * apprentice app is not checked out beside the API, the test says so and skips
 * rather than passing vacuously — a green result from a file that was never
 * read would be worse than no test.
 */
describe('OTJ category contract (F3.1.1 AC2)', () => {
  const constantsPath = join(
    process.cwd(),
    '..',
    'gradlly-frontend',
    'apps',
    'apprentice',
    'features',
    'otj',
    'constants',
    'index.js',
  );

  let source: string | null = null;
  try {
    source = readFileSync(constantsPath, 'utf8');
  } catch {
    source = null;
  }

  const maybeIt = source ? it : it.skip;

  it('reports whether the frontend constant could be read', () => {
    if (!source) {
      // Deliberately not a failure: the API repo must build on its own. But it
      // must be visible that the contract went unchecked, not silently green.
      console.warn(
        `OTJ category contract UNCHECKED — apprentice app not found at ${constantsPath}`,
      );
    }
    expect(true).toBe(true);
  });

  maybeIt('offers exactly the categories the API accepts', () => {
    const block = source!.match(
      /OTJ_CATEGORY_OPTIONS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/,
    );
    expect(block).not.toBeNull();

    const frontendValues = [...block![1].matchAll(/value:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    const apiValues = Object.values(OtjActivityCategory);

    // Sorted comparison: AC2 fixes the display order, which is a UI concern.
    // What must match is the set of accepted values.
    expect([...frontendValues].sort()).toEqual([...apiValues].sort());
  });

  maybeIt('gives every option a non-empty label', () => {
    const block = source!.match(
      /OTJ_CATEGORY_OPTIONS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/,
    );
    const labels = [...block![1].matchAll(/text:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );

    expect(labels).toHaveLength(Object.values(OtjActivityCategory).length);
    for (const label of labels) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });
});
