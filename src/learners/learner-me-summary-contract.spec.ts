import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * P0-A — the three new summary fields, asserted against the **published**
 * spec rather than against the DTO that produced it.
 *
 * WHY THIS TEST EXISTS. Four consumers are about to read these fields:
 * F3.1.1's confirmation screen, F3.1.2's progress view, F3.1.3's history and
 * F3.1.4's alert copy. The apprentice app generates its types from
 * `openapi.json` (`api:types` → `openapi-typescript`), so a field that exists
 * on the DTO but never reached the published spec produces a compile error in
 * four places at once — or worse, a field renamed in one and not the other
 * produces `undefined` at runtime and renders as a confident zero.
 *
 * F3.1.1 already hit this class of defect once: the OTJ category constants
 * drifted between frontend and API, which is why
 * `otj/otj-categories-contract.spec.ts` exists. This is the same guard for the
 * same reason.
 *
 * WHAT MAKES IT MEANINGFUL. It reads `openapi.json` off disk as text. It does
 * not import the DTO's metadata and compare it to itself, which would pass
 * whether or not anybody ever ran `openapi:emit`. Emitting the spec is a
 * separate, forgettable step, and forgetting it is the actual failure mode.
 *
 * ── A BUILD HAZARD THIS TEST CANNOT CATCH ────────────────────────────────────
 *
 * `openapi:emit` runs `nest build` first, deliberately: the Swagger CLI plugin
 * declared in `nest-cli.json` is what infers `type: number, nullable: true`
 * from a `number | null` property. Building with plain `tsc` instead skips the
 * plugin, and because `nest-cli.json` sets `deleteOutDir: false`, a later
 * `nest build` leaves the plugin-less output in place for any file it considers
 * unchanged. The next emit then publishes every nullable field as
 * `"type": "object"` — a repo-wide contract regression from a build shortcut.
 *
 * If a spec diff ever shows nullable fields turning into `object`, delete
 * `dist/` and run `nest build` before assuming a DTO is at fault.
 */
describe('LearnerMeSummary OTJ pace contract', () => {
  const specPath = join(process.cwd(), 'openapi.json');

  /**
   * Reported rather than silently skipped. A green result from a file that was
   * never read is worse than no test at all.
   */
  const specExists = existsSync(specPath);
  if (!specExists) {
    it('WARNING: openapi.json is absent — run `yarn openapi:emit`', () => {
      expect(specExists).toBe(true);
    });
    return;
  }

  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
    components: {
      schemas: Record<
        string,
        {
          properties?: Record<string, { type?: string; nullable?: boolean }>;
          required?: string[];
        }
      >;
    };
  };

  const pace = spec.components.schemas.LearnerMeSummaryOtjPaceDto;

  it('publishes the pace schema at all', () => {
    expect(pace).toBeDefined();
    expect(pace.properties).toBeDefined();
  });

  /**
   * Naming and casing are asserted literally. The F3.1.1 contract test caught a
   * snake_case/camelCase drift already; the same slip here breaks four
   * consumers instead of one.
   */
  it.each([
    'approvedMinutes',
    'loggedMinutes',
    'pendingMinutes',
    'rejectedMinutes',
  ])('publishes %s as a required, non-nullable number', (field) => {
    expect(Object.keys(pace.properties ?? {})).toContain(field);
    expect(pace.properties?.[field]?.type).toBe('number');

    // Not nullable, and deliberately so: a minute count cannot be unknown —
    // the query COALESCEs to 0. Contrast otjPercent below, which genuinely can.
    expect(pace.properties?.[field]?.nullable).toBeUndefined();
    expect(pace.required ?? []).toContain(field);
  });

  /**
   * The unknown-versus-zero distinction, pinned. `otjPercent` is null when the
   * programme has no planned duration; rendering that as 0% tells a learner
   * they have logged nothing, which is a different and wrong statement.
   *
   * This also guards the build hazard described above — under a plugin-less
   * build this property degrades to `"type": "object"`.
   */
  it('keeps otjPercent nullable and typed as a number', () => {
    expect(pace.properties?.otjPercent?.type).toBe('number');
    expect(pace.properties?.otjPercent?.nullable).toBe(true);
  });

  /**
   * D2: approved is authoritative and pending is shown separately, so a merged
   * total has no consumer. Asserted as an absence so that adding one is a
   * deliberate act with a failing test attached, not a quiet convenience.
   */
  it('publishes no combined total', () => {
    const names = Object.keys(pace.properties ?? {});
    for (const forbidden of [
      'totalMinutes',
      'combinedMinutes',
      'totalLoggedMinutes',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  /**
   * The complete published field set, pinned.
   *
   * `arrayContaining` would let a field be dropped without failing, so this
   * compares the sorted set exactly: adding or removing a field is then a
   * deliberate act with a failing test attached.
   */
  it('publishes exactly the expected field set', () => {
    expect(Object.keys(pace.properties ?? {}).sort()).toEqual([
      'alertLevel',
      'approvedMinutes',
      'loggedMinutes',
      'otjPercent',
      'pendingMinutes',
      'rejectedMinutes',
    ]);
  });
});
