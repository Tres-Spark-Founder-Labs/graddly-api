/**
 * A partial row, or a partial query DTO, standing in for the whole thing in a
 * unit test.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * Unit specs pass the two or three fields the code under test reads: an
 * `Organisation` with only a `ukprn`, a `ListXQueryDto` with no filters.
 * That is the right amount of fixture — but the parameter types are the whole
 * entity, so every one of those literals was a `tsc --noEmit` error that
 * ts-jest never reported.
 *
 * The cast lives here, once, named and explained, rather than as an `as`
 * scattered through the specs or a widened parameter type in production code.
 * The compiler still checks the field *names* and their types through
 * `Partial<T>`, so a renamed column still fails; only the completeness check
 * is waived, which is exactly what a fixture wants.
 */
export function testEntity<T>(fields: Partial<T>): T {
  return fields as T;
}
