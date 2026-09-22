import { DataSource } from 'typeorm';

import { runWithTenantContext } from '../common/context/correlation-id-context.js';
import * as validateEnv from '../config/validate-env.js';

import { isTenantGucQuery } from './apply-tenant-gucs.js';
import { isGucExemptStatement } from './postgres-query-runner.patch.js';

import type { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver.js';

/**
 * The tenant session-variable SELECT is sent in front of every statement
 * except the ROLLBACK family and SET TRANSACTION — checked against the
 * statements TypeORM actually emits.
 *
 * ── WHY THE STATEMENTS ARE CAPTURED, NOT WRITTEN ────────────────────────────
 *
 * The exemption is a match on statement text, which is only as good as the
 * strings it expects. A spec that lists the strings we think TypeORM sends
 * reflects our assumptions back at us and proves nothing. So the statements
 * below come from a real `PostgresQueryRunner`, built by a real `DataSource`
 * through the real patched prototype, with only the socket faked: what the
 * fake receives is exactly what Postgres would.
 *
 * The behaviour itself — a failed statement leaves the pooled connection
 * clean, and a REPEATABLE READ transaction opens — is proved against
 * Postgres in test/pooled-connection-after-failure.e2e-spec.ts.
 */
describe('postgres-query-runner.patch', () => {
  /** Everything the fake socket received, in order. */
  let wire: string[];

  const dataSource = new DataSource({
    type: 'postgres',
    host: 'localhost',
    database: 'never-connected',
    entities: [],
  });

  function minimalEnv() {
    /* eslint-disable @typescript-eslint/naming-convention -- keys mirror process.env */
    return {
      ...validateEnv.parseEnv({
        NODE_ENV: 'development',
        JWT_SECRET: 'change-me-in-production',
      }),
      TENANT_DB_CONTEXT_ENABLED: true,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
  }

  beforeEach(() => {
    wire = [];
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv());

    // The pg client, faked at the socket: records each statement, answers
    // with an empty result. Nothing else in the path is a double.
    const socket = {
      query: (sql: string) => {
        wire.push(sql);
        return Promise.resolve({ rows: [], rowCount: 0, command: 'SELECT' });
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
    const driver = dataSource.driver as PostgresDriver;
    jest
      .spyOn(driver, 'obtainMasterConnection')
      .mockResolvedValue([socket, () => undefined]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Drives one transaction shape through the runner, as the app would: a
   * REPEATABLE READ transaction, a statement, a savepoint rolled back, a
   * savepoint released, a rollback; then a transaction committed.
   */
  async function driveTypeOrmTransactions(): Promise<void> {
    await runWithTenantContext(
      { label: 'spec', organisationId: 'org-1', userId: 'user-1' },
      async () => {
        const runner = dataSource.createQueryRunner();
        await runner.startTransaction('REPEATABLE READ');
        await runner.query('SELECT 1');
        await runner.startTransaction();
        await runner.rollbackTransaction();
        await runner.startTransaction();
        await runner.commitTransaction();
        await runner.rollbackTransaction();

        await runner.startTransaction();
        await runner.query('INSERT INTO t (id) VALUES ($1)', [1]);
        await runner.commitTransaction();
        await runner.release();
      },
    );
  }

  /** Each statement TypeORM sent, with whether the tenant SELECT preceded it. */
  function statementsWithPrefix(): { sql: string; prefixed: boolean }[] {
    return wire
      .map((sql, i) => ({
        sql,
        prefixed: i > 0 && isTenantGucQuery(wire[i - 1]),
      }))
      .filter(({ sql }) => !isTenantGucQuery(sql));
  }

  it('sends the tenant SELECT in front of every statement except the exempt ones', async () => {
    await driveTypeOrmTransactions();

    const statements = statementsWithPrefix();
    // The shapes this spec is about are all present, as TypeORM emits them.
    expect(statements.map((s) => s.sql)).toEqual([
      'START TRANSACTION',
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      'SELECT 1',
      'SAVEPOINT typeorm_1',
      'ROLLBACK TO SAVEPOINT typeorm_1',
      'SAVEPOINT typeorm_1',
      'RELEASE SAVEPOINT typeorm_1',
      'ROLLBACK',
      'START TRANSACTION',
      'INSERT INTO t (id) VALUES ($1)',
      'COMMIT',
    ]);

    for (const { sql, prefixed } of statements) {
      // Exempt ⇔ no tenant SELECT in front of it.
      expect({ sql, prefixed }).toEqual({
        sql,
        prefixed: !isGucExemptStatement(sql),
      });
    }
    expect(statements.filter((s) => !s.prefixed).map((s) => s.sql)).toEqual([
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      'ROLLBACK TO SAVEPOINT typeorm_1',
      'ROLLBACK',
    ]);
  });

  it('SET TRANSACTION is the first statement of its transaction', async () => {
    await driveTypeOrmTransactions();

    const start = wire.indexOf('START TRANSACTION');
    expect(wire[start + 1]).toBe(
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    );
    // And the first statement that reads is still preceded by the SELECT,
    // inside the transaction, with the level already in force.
    expect(isTenantGucQuery(wire[start + 2])).toBe(true);
    expect(wire[start + 3]).toBe('SELECT 1');
  });

  /**
   * The match must hold for the captured statements however they are
   * written: any case, leading whitespace, a trailing semicolon, and a
   * quoted savepoint identifier. The variants are derived from the captured
   * statements, not typed in.
   */
  describe('the match, over variants of what TypeORM emits', () => {
    const variants = (sql: string): string[] => [
      sql,
      sql.toLowerCase(),
      `  ${sql}`,
      `${sql};`,
      `\n\t${sql.toLowerCase()};`,
      sql.replace(/\b(typeorm_\d+)\b/, '"$1"'),
    ];

    let captured: { sql: string; prefixed: boolean }[];

    beforeEach(async () => {
      await driveTypeOrmTransactions();
      captured = statementsWithPrefix();
    });

    it('exempts every variant of a statement the runner sent without the SELECT', () => {
      const exempt = captured.filter((s) => !s.prefixed).map((s) => s.sql);
      expect(exempt).toContain('ROLLBACK TO SAVEPOINT typeorm_1');
      for (const sql of exempt) {
        for (const variant of variants(sql)) {
          expect({ variant, exempt: isGucExemptStatement(variant) }).toEqual({
            variant,
            exempt: true,
          });
        }
      }
      // The quoted-identifier variant is a real one for this statement.
      expect(
        variants('ROLLBACK TO SAVEPOINT typeorm_1').find((v) =>
          v.includes('"'),
        ),
      ).toBe('ROLLBACK TO SAVEPOINT "typeorm_1"');
    });

    it('exempts no variant of a statement the runner sent with the SELECT', () => {
      const kept = captured.filter((s) => s.prefixed).map((s) => s.sql);
      expect(kept).toContain('COMMIT');
      for (const sql of kept) {
        for (const variant of variants(sql)) {
          expect({ variant, exempt: isGucExemptStatement(variant) }).toEqual({
            variant,
            exempt: false,
          });
        }
      }
    });
  });

  it.each([
    // ABORT is the Postgres synonym for ROLLBACK; TypeORM never emits it.
    ['ABORT', true],
    // Content that mentions rollback is not a rollback.
    ['SELECT rollback_count FROM stats', false],
    ['UPDATE t SET note = $1 -- ROLLBACK', false],
    ["SET search_path TO 'public'", false],
  ])(
    '%p is exempt: %p (statements Postgres accepts, not from TypeORM)',
    (sql, exempt) => {
      expect(isGucExemptStatement(sql)).toBe(exempt);
    },
  );
});
