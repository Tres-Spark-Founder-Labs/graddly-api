import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two halves of the audit trail must agree.
 *
 * Writing an audit row takes two decisions in `audit-organisation-id.resolver.ts`:
 *
 *   `isAuditedEntity`            does this entity produce a row at all?
 *   `resolveAuditOrganisationId` which organisation does that row belong to?
 *
 * Both are hand-maintained lists — one of classes, one of table names — and
 * nothing has ever compared them. Four faults had accumulated, in both
 * directions:
 *
 *   das_levy_monthly_entries, das_funding_payments, commitment_chase_dispatches
 *     in the resolver, absent from `isAuditedEntity`. No row is written at all;
 *     the write is simply never audited.
 *
 *   programmes
 *     audited, but with no resolver branch it falls through to `return null`.
 *     The row IS written, with `organisationId: null` — and
 *     `audit-export.service.ts:50` filters on
 *     `audit.organisationId = :organisationId`, which in SQL is never true for
 *     NULL. The row exists and no tenant can ever retrieve it, so the report
 *     shows nothing happened. That is worse than the missing-row case, because
 *     it looks like an answer.
 *
 * These tests read both lists out of the source file rather than importing
 * them, because `isAuditedEntity` takes a value and gives a boolean — there is
 * no exported list to compare. Parsing is the price of catching a class of bug
 * that four separate reviews missed.
 */
const RESOLVER_PATH = join(
  process.cwd(),
  'src/audit/audit-organisation-id.resolver.ts',
);
const source = readFileSync(RESOLVER_PATH, 'utf8');

/** Entity class names listed in `isAuditedEntity`. */
function auditedClasses(): string[] {
  const fn = source.slice(source.indexOf('export function isAuditedEntity'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  return [...body.matchAll(/ctor === (\w+)/g)].map((m) => m[1]).sort();
}

/** Table names given an organisation-resolution branch. */
function resolverTables(): string[] {
  const fn = source.slice(
    source.indexOf('export function resolveAuditOrganisationId'),
    source.indexOf('export function isAuditedEntity'),
  );
  return [...fn.matchAll(/entityType === '(\w+)'/g)].map((m) => m[1]).sort();
}

/**
 * Class name to table name.
 *
 * TypeORM derives the table from `@Entity('name')`, so the only reliable
 * mapping is to read it from the entity file. Resolved by searching the source
 * tree for the class declaration and taking its decorator argument.
 */
function tableForClass(className: string): string | null {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  let out = '';
  try {
    out = execSync(
      `grep -rl "export class ${className} " src --include="*.entity.ts"`,
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim();
  } catch {
    return null;
  }
  const file = out.split('\n')[0];
  if (!file) return null;
  const entitySource = readFileSync(join(process.cwd(), file), 'utf8');
  const match = entitySource.match(/@Entity\('([^']+)'\)/);
  return match ? match[1] : null;
}

describe('audit coverage — isAuditedEntity and resolveAuditOrganisationId agree', () => {
  const classes = auditedClasses();
  const tables = resolverTables();

  it('reads both lists successfully', () => {
    // Guards the parsing itself: if the file is restructured and these regexes
    // stop matching, every assertion below would pass vacuously.
    expect(classes.length).toBeGreaterThan(30);
    expect(tables.length).toBeGreaterThan(30);
  });

  it('every audited entity has a resolver branch, so no row is written with a null organisation', () => {
    const missing = classes
      .map((c) => ({ className: c, table: tableForClass(c) }))
      // `organisations` resolves through its own `id`, not `organisationId`,
      // and has a dedicated branch above the generic block.
      .filter((x) => x.table && x.table !== 'organisations')
      .filter((x) => !tables.includes(x.table as string))
      .map((x) => `${x.className} (${x.table as string})`);

    expect(missing).toEqual([]);
  });

  it('every table in the resolver is actually audited, so the branch is not dead', () => {
    const classTables = new Set(
      classes.map((c) => tableForClass(c)).filter(Boolean) as string[],
    );
    const orphaned = tables.filter((t) => !classTables.has(t));

    expect(orphaned).toEqual([]);
  });
});
