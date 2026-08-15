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
  /**
   * Where the apprentice app lives.
   *
   * `GRADLLY_FRONTEND_DIR` exists because CI cannot use the sibling default:
   * `actions/checkout` refuses to write outside `$GITHUB_WORKSPACE`, so the
   * frontend is checked out *inside* the API workspace and this points at it.
   * Locally the sibling layout is the normal one and needs no configuration.
   */
  const frontendDir =
    process.env.GRADLLY_FRONTEND_DIR?.trim() ||
    join(process.cwd(), '..', 'gradlly-frontend');

  const constantsPath = join(
    frontendDir,
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

  /**
   * `OTJ_CONTRACT_REQUIRED=true` turns a skip into a failure.
   *
   * Without it this suite reports PASS when the apprentice app is absent — which
   * is right for a developer working in the API alone, and was silently wrong in
   * CI for months: the frontend was never checked out there, so the gate that
   * exists to catch category drift never once ran and every build reported
   * green. A contract that cannot fail is not a contract.
   *
   * CI sets it. If the checkout is misconfigured or its token expires, this
   * fails loudly instead of quietly reverting to unprotected.
   */
  const required = process.env.OTJ_CONTRACT_REQUIRED === 'true';

  it('can read the apprentice app constant', () => {
    /**
     * Resolved to a value first, then asserted once. Branching around `expect`
     * trips `jest/no-conditional-expect`, and that rule is right to complain:
     * a conditional assertion is one that can silently not run, which is the
     * exact failure this whole file exists to prevent.
     */
    const failure =
      source || !required
        ? null
        : `OTJ category contract could not run: apprentice constants not found ` +
          `at ${constantsPath}. OTJ_CONTRACT_REQUIRED=true, so this is a ` +
          `failure rather than a skip — check the frontend checkout step and ` +
          `GRADLLY_FRONTEND_DIR.`;

    if (!source && !required) {
      // Not a failure locally: the API repo must build on its own. But it must
      // be visible that the contract went unchecked, not silently green.
      // eslint-disable-next-line no-console -- the visibility is the point
      console.warn(
        `OTJ category contract UNCHECKED — apprentice app not found at ${constantsPath}`,
      );
    }

    expect(failure).toBeNull();
  });

  /**
   * Skipped at the `describe` level rather than per-test via an aliased `it`.
   * An alias reads fine but hides the assertions from `jest/no-standalone-expect`,
   * which then cannot tell a real standalone `expect` from a skipped one — so
   * the lint rule that exists to catch assertions outside a test block gets
   * switched off for exactly the file that most needs it.
   */
  const whenApprenticeAppPresent = source ? describe : describe.skip;

  whenApprenticeAppPresent('against the checked-out apprentice app', () => {
    const optionsBlock = () =>
      source!.match(
        /OTJ_CATEGORY_OPTIONS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/,
      );

    it('offers exactly the categories the API accepts', () => {
      const block = optionsBlock();
      expect(block).not.toBeNull();

      const frontendValues = [...block![1].matchAll(/value:\s*"([^"]+)"/g)].map(
        (m) => m[1],
      );
      const apiValues = Object.values(OtjActivityCategory);

      // Sorted comparison: AC2 fixes the display order, which is a UI concern.
      // What must match is the set of accepted values.
      expect([...frontendValues].sort()).toEqual([...apiValues].sort());
    });

    it('gives every option a non-empty label', () => {
      const block = optionsBlock();
      const labels = [...block![1].matchAll(/text:\s*"([^"]+)"/g)].map(
        (m) => m[1],
      );

      expect(labels).toHaveLength(Object.values(OtjActivityCategory).length);
      for (const label of labels) {
        expect(label.trim().length).toBeGreaterThan(0);
      }
    });
  });
});
