import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildDeleteChanges,
  buildInsertChanges,
  buildUpdateChanges,
} from './audit-changes.util.js';
import { AUDIT_EXCLUDED_FIELDS } from './audit.constants.js';

/**
 * No audited payload may carry a hash, a secret or a token.
 *
 * ── WHY THIS IS A TEST AND NOT A CODE REVIEW ────────────────────────────────
 *
 * `audit_log_entries.changes` is before/after JSON, the table is append-only
 * by trigger, and retention is seven years. There is no UPDATE and no DELETE
 * available to fix a mistake — the GDPR routine may rewrite three named
 * columns and nothing else. So a credential that reaches a payload once is in
 * an evidence table, unremovable, until 2033.
 *
 * Auditing `users` is what made this urgent: the entity holds `password`,
 * `mfaSecret` and `mfaRecoveryCodes`, and the whole point of the coverage was
 * to record email changes, which are the account-takeover path.
 *
 * Two kinds of assertion below, because either alone can pass while the
 * system leaks:
 *
 *   1. payload-level — build the real change payloads from entity-shaped
 *      objects and assert no credential key or credential-looking value
 *      survives. Catches a change to the field filter.
 *   2. list-level — read every audited entity's columns out of its own
 *      source file and assert that each credential-shaped one is excluded.
 *      Catches the case a payload test cannot see: an audited entity that
 *      gains a `secret` column tomorrow. This is how the DAS donor OAuth
 *      tokens were found; `DasDonorOAuthToken` has been audited since the
 *      levy exchange work, and its `accessTokenEncrypted` and
 *      `refreshTokenEncrypted` columns were being written into the trail.
 */
const CREDENTIAL_NAME =
  /password|secret|token|hash|recovery|apikey|privatekey/i;

/** A bcrypt digest, the shape most likely to leak by accident. */
const BCRYPT = /^\$2[aby]\$\d{2}\$/;

const SECRETS = {
  password: '$2b$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ',
  mfaSecret: 'v1:9f8a7b6c5d4e3f2a1b0c:ZmFrZS10b3RwLXNlY3JldA==',
  mfaRecoveryCodes: ['$2b$12$recoveryone', '$2b$12$recoverytwo'],
  accessTokenEncrypted: 'enc:eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake',
  refreshTokenEncrypted: 'enc:cmVmcmVzaC10b2tlbi1mYWtl',
};

/** Every string anywhere in a payload, however nested. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsIn);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

function assertNoCredentials(changes: Record<string, unknown>): void {
  const keys = Object.keys(changes);
  expect(keys.filter((key) => CREDENTIAL_NAME.test(key))).toEqual([]);

  const values = stringsIn(changes);
  expect(values.filter((value) => BCRYPT.test(value))).toEqual([]);
  for (const secret of [
    SECRETS.password,
    SECRETS.mfaSecret,
    SECRETS.accessTokenEncrypted,
    SECRETS.refreshTokenEncrypted,
    ...SECRETS.mfaRecoveryCodes,
  ]) {
    expect(values).not.toContain(secret);
  }
}

/** The user rows the subscriber sees: a signup, and an email change. */
const userBefore = {
  id: 'user-1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  isEmailVerified: true,
  isActive: true,
  mfaEnabled: false,
  ...SECRETS,
};

const userAfter = {
  ...userBefore,
  // The change this coverage exists for.
  email: 'attacker@example.com',
  mfaEnabled: true,
  password: '$2b$12$aDifferentHashEntirely0123456789ABCDEFGHIJKLMNOPQRST',
  mfaSecret: 'v1:rotated:c2Vjb25kLXNlY3JldA==',
};

describe('audit payloads carry no credentials', () => {
  it('leaves the password, TOTP secret and recovery codes out of an insert', () => {
    const changes = buildInsertChanges(userBefore);

    // The audit is still worth having: the identifying fields are there.
    expect(Object.keys(changes)).toContain('email');
    expect(Object.keys(changes)).toContain('firstName');
    assertNoCredentials(changes);
  });

  it('records that the email changed, and neither hash either side of it', () => {
    const changes = buildUpdateChanges(userBefore, userAfter);

    expect(changes.email).toEqual({
      from: 'ada@example.com',
      to: 'attacker@example.com',
    });
    // MFA being switched on is a security-relevant fact; the seed is not.
    expect(changes.mfaEnabled).toEqual({ from: false, to: true });
    assertNoCredentials(changes);
  });

  it('leaves them out of a soft delete too', () => {
    const changes = buildDeleteChanges(userBefore, {
      ...userBefore,
      isActive: false,
    });

    expect(changes.isDeleted).toEqual({ from: false, to: true });
    assertNoCredentials(changes);
  });

  it('leaves the DAS donor OAuth tokens out of their own audit rows', () => {
    const token = {
      id: 'token-1',
      organisationId: 'org-1',
      donorLinkId: 'link-1',
      scope: 'levy.read',
      accessTokenEncrypted: SECRETS.accessTokenEncrypted,
      refreshTokenEncrypted: SECRETS.refreshTokenEncrypted,
    };

    const inserted = buildInsertChanges(token);
    expect(Object.keys(inserted)).toContain('scope');
    assertNoCredentials(inserted);

    const refreshed = buildUpdateChanges(token, {
      ...token,
      accessTokenEncrypted: 'enc:rotated-access',
      refreshTokenEncrypted: 'enc:rotated-refresh',
    });
    assertNoCredentials(refreshed);
  });
});

/**
 * The list-level half. Parsed out of the source for the same reason
 * `audit-coverage.spec.ts` parses: `isAuditedEntity` takes a value and
 * returns a boolean, so there is no list to import.
 */
function auditedClasses(): string[] {
  const source = readFileSync(
    join(process.cwd(), 'src/audit/audit-organisation-id.resolver.ts'),
    'utf8',
  );
  const fn = source.slice(source.indexOf('export function isAuditedEntity'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  return [...body.matchAll(/ctor === (\w+)/g)].map((m) => m[1]);
}

function entityFileFor(className: string): string | null {
  try {
    const out = execSync(
      `grep -rl "export class ${className} " src --include="*.entity.ts"`,
      { cwd: process.cwd(), encoding: 'utf8' },
    ).trim();
    return out.split('\n')[0] || null;
  } catch {
    return null;
  }
}

/**
 * The persisted columns of an entity: a property counts only when `@Column`
 * appears in the decorators directly above it.
 *
 * Relation properties are deliberately not columns here. `DasDonorLink`
 * declares `oauthToken!: DasDonorOAuthToken` through `@OneToOne`, which reads
 * like a credential and is an object — and `isAuditableScalar` in
 * `audit-changes.util.ts` drops every object, so no relation reaches a
 * payload whatever it is called. Counting them would make this test fail on
 * something that cannot leak, and a test that cries wolf gets excluded from
 * the run.
 */
function columnNames(file: string): string[] {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  const columns: string[] = [];
  let decorators: string[] = [];

  for (const line of source.split('\n')) {
    const property = line.match(/^ {2}(\w+)!?[?]?:/);
    if (property) {
      if (decorators.some((d) => d.includes('@Column'))) {
        columns.push(property[1]);
      }
      decorators = [];
      continue;
    }
    if (line.trimStart().startsWith('@')) {
      decorators.push(line);
      continue;
    }
    // Keep collecting through a multi-line decorator argument; reset on a
    // blank line, which is what separates one property from the next.
    if (line.trim() === '') {
      decorators = [];
    }
  }

  return columns;
}

describe('every credential-shaped column on an audited entity is excluded', () => {
  it('finds the audited classes, so the assertion below is not vacuous', () => {
    expect(auditedClasses().length).toBeGreaterThan(30);
  });

  it('has no unexcluded credential column anywhere in the audited set', () => {
    const leaking: string[] = [];

    for (const className of auditedClasses()) {
      const file = entityFileFor(className);
      if (!file) {
        continue;
      }
      for (const column of columnNames(file)) {
        if (!CREDENTIAL_NAME.test(column)) {
          continue;
        }
        if (!AUDIT_EXCLUDED_FIELDS.has(column)) {
          leaking.push(`${className}.${column}`);
        }
      }
    }

    /**
     * A failure here is a decision, not a chore: either the column is a
     * credential and belongs in AUDIT_EXCLUDED_FIELDS, or it is evidence that
     * happens to be named like one — a signed document's `signatureImageHash`
     * is the example — and the pattern above needs narrowing with a note
     * saying which and why.
     */
    expect(leaking).toEqual([]);
  });
});
