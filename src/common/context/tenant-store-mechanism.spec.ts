import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * A tenant value lives on the AsyncLocalStorage store, and nowhere else.
 *
 * Sibling of `rls-bootstrap-mechanism.spec.ts`, which stops the bootstrap flag
 * being set other than through `withRlsBootstrap`. This one covers the values
 * every policy compares against — `app.current_org` and `app.current_user` —
 * which had the same defect in a different coat: `resolveTenantGucValues`
 * fell through `??` to `synchronousTenantFallback` and then to
 * `lastKnownOrganisationIdForGuc` / `lastKnownUserIdForGuc`, three
 * process-globals written by every request's guards and every job. A request
 * whose store carried no organisation, or a worker job with no store at all,
 * sent whichever tenant had written last. Those globals are deleted, not
 * deprecated, and `tenant-guc-org-resolution.spec.ts` is the acceptance
 * check. This file is what stops them coming back.
 *
 * ── WHAT IS ENFORCED, ACROSS EVERY PRODUCTION FILE ──────────────────────────
 *
 *   1. None of the retired names is referenced. `setLastKnownUserIdForGuc`,
 *      `synchronousTenantFallback`, `getTenantRequestContext` and the rest
 *      are gone; nothing may import, declare or call them.
 *
 *   2. The two modules a tenant value passes through —
 *      `correlation-id-context.ts` and `apply-tenant-gucs.ts` — hold no
 *      module-scope mutable state beyond a named allowlist. A `let`, or a
 *      `const` bound to an object, array, `new …` or a call (anything that
 *      can be written after the module loads), is a place a tenant value
 *      could be parked for another request to read. Each allowed binding is
 *      listed with its reason; the AsyncLocalStorage itself is one of them.
 *
 *   3. `resolveTenantGucValues` reads the store getters and nothing else. Its
 *      body may reference only those getters, its own locals and the
 *      once-per-label warning. A `?? somethingElse` — the shape of the old
 *      fallback — is a finding, whichever module `somethingElse` comes from.
 */

const SRC = join(__dirname, '..', '..');
const CONTEXT_MODULE = 'common/context/correlation-id-context.ts';
const GUC_MODULE = 'database/apply-tenant-gucs.ts';
const RESOLVER = 'resolveTenantGucValues';

/** Retired names: the fallback, the last-known globals, the per-correlation map. */
const RETIRED_NAME =
  /lastKnown(?:User|Organisation)IdForGuc|synchronousTenantFallback|tenantRequestContext|tenantByCorrelationId/i;

/**
 * Module-scope bindings allowed to be mutable, each with the reason it is not
 * a tenant value. Anything else at module scope in these files is a finding.
 */
const ALLOWED_MODULE_STATE: Record<string, Record<string, string>> = {
  [CONTEXT_MODULE]: {
    storage: 'the AsyncLocalStorage: the store lives here, per async chain',
  },
  [GUC_MODULE]: {
    runGucQuery: 'the query runner hook, wired once at startup',
    logger: 'a Nest logger',
    warnedMissing: 'labels already warned about, so each warns once',
  },
};

/** What the resolver's body may reference. */
const RESOLVER_MAY_REFERENCE = new Set([
  'getCurrentOrganisationId',
  'getCurrentUserId',
  'getRlsBootstrap',
  'warnMissingOnce',
  'orgId',
  'userId',
]);

interface ISource {
  path: string;
  text: string;
}

function productionSources(): ISource[] {
  const sources: ISource[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.spec.ts')
      ) {
        sources.push({
          path: relative(SRC, full).split(sep).join('/'),
          text: readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(SRC);
  return sources;
}

function parse(source: ISource): ts.SourceFile {
  return ts.createSourceFile(
    source.path,
    source.text,
    ts.ScriptTarget.Latest,
    true,
  );
}

const location = (file: ts.SourceFile, node: ts.Node): string =>
  `${file.fileName}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

/** Rule 1: every identifier in production source that is a retired name. */
function retiredNames(sources: ISource[]): string[] {
  const found: string[] = [];
  for (const source of sources) {
    const file = parse(source);
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && RETIRED_NAME.test(node.text)) {
        found.push(`${location(file, node)} ${node.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

/**
 * A binding whose value can change after the module loads: a `let`/`var`, or
 * a `const` holding something with insides — an object or array literal, a
 * `new`, or whatever a call returned. A `const` string, number or function is
 * not a place to park a value.
 */
function isMutableBinding(declaration: ts.VariableDeclaration): boolean {
  const list = declaration.parent;
  if (
    ts.isVariableDeclarationList(list) &&
    (list.flags & ts.NodeFlags.Const) === 0
  ) {
    return true;
  }
  const init = declaration.initializer;
  if (!init) {
    return true;
  }
  return (
    ts.isObjectLiteralExpression(init) ||
    ts.isArrayLiteralExpression(init) ||
    ts.isNewExpression(init) ||
    ts.isCallExpression(init)
  );
}

/** Rule 2: module-scope mutable bindings in the tenant modules, less the allowlist. */
function moduleState(sources: ISource[]): string[] {
  const found: string[] = [];
  for (const source of sources) {
    const allowed = ALLOWED_MODULE_STATE[source.path];
    if (!allowed) {
      continue;
    }
    const file = parse(source);
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText();
        if (isMutableBinding(declaration) && !(name in allowed)) {
          found.push(`${location(file, declaration)} ${name}`);
        }
      }
    }
  }
  return found;
}

/** Rule 3: identifiers the resolver's body references beyond the store getters. */
function resolverReferences(sources: ISource[]): {
  found: string[];
  resolvers: number;
} {
  const found: string[] = [];
  let resolvers = 0;
  for (const source of sources) {
    if (source.path !== GUC_MODULE) {
      continue;
    }
    const file = parse(source);
    for (const statement of file.statements) {
      if (
        !ts.isFunctionDeclaration(statement) ||
        statement.name?.text !== RESOLVER ||
        !statement.body
      ) {
        continue;
      }
      resolvers += 1;
      const visit = (node: ts.Node): void => {
        if (
          ts.isIdentifier(node) &&
          !(
            ts.isPropertyAccessExpression(node.parent) &&
            node.parent.name === node
          ) &&
          !RESOLVER_MAY_REFERENCE.has(node.text)
        ) {
          found.push(`${location(file, node)} ${node.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(statement.body);
    }
  }
  return { found, resolvers };
}

describe('a tenant value lives only on the store', () => {
  const sources = productionSources();

  it('scans both tenant modules and finds the resolver', () => {
    // Guards the guard: a scan that read nothing would pass the rules below.
    const paths = new Set(sources.map((source) => source.path));
    expect(paths.has(CONTEXT_MODULE)).toBe(true);
    expect(paths.has(GUC_MODULE)).toBe(true);
    expect(resolverReferences(sources).resolvers).toBe(1);
  });

  it('references none of the retired names in any production file', () => {
    expect(retiredNames(sources)).toEqual([]);
  });

  it('keeps no module-scope state in the tenant modules beyond the allowlist', () => {
    expect(moduleState(sources)).toEqual([]);
  });

  it('resolves the GUC values from the store getters and nothing else', () => {
    expect(resolverReferences(sources).found).toEqual([]);
  });

  describe('the rules still bite', () => {
    const one = (path: string, text: string): ISource[] => [{ path, text }];

    it('sees a retired name used, declared or imported', () => {
      expect(
        retiredNames(
          one(
            'auth/guards/x.guard.ts',
            "import { setLastKnownUserIdForGuc } from '../../database/apply-tenant-gucs.js';\nsetLastKnownUserIdForGuc(user.id);",
          ),
        ),
      ).toEqual([
        'auth/guards/x.guard.ts:1 setLastKnownUserIdForGuc',
        'auth/guards/x.guard.ts:2 setLastKnownUserIdForGuc',
      ]);
      expect(
        retiredNames(
          one(CONTEXT_MODULE, 'const synchronousTenantFallback = {};'),
        ),
      ).toEqual([`${CONTEXT_MODULE}:1 synchronousTenantFallback`]);
    });

    it('sees a new global in the context module, whatever it is called', () => {
      expect(
        moduleState(
          one(
            CONTEXT_MODULE,
            [
              'const storage = new AsyncLocalStorage<ICorrelationIdStore>();',
              'let currentOrganisation: string | undefined;',
              'const fallback = { currentOrganisationId: undefined };',
              'const byCorrelation = new Map<string, string>();',
              'const cached = readSomething();',
            ].join('\n'),
          ),
        ),
      ).toEqual([
        `${CONTEXT_MODULE}:2 currentOrganisation`,
        `${CONTEXT_MODULE}:3 fallback`,
        `${CONTEXT_MODULE}:4 byCorrelation`,
        `${CONTEXT_MODULE}:5 cached`,
      ]);
    });

    it('lets the GUC module keep its allowed bindings and plain constants', () => {
      expect(
        moduleState(
          one(
            GUC_MODULE,
            [
              "export const TENANT_GUC_SQL = 'SELECT 1';",
              'let runGucQuery: GucQueryFn | null = null;',
              "const logger = new Logger('TenantGucs');",
              'const warnedMissing = new Set<string>();',
              'const label = (kind: string): string => kind;',
            ].join('\n'),
          ),
        ),
      ).toEqual([]);
    });

    it('ignores module scope in every other file', () => {
      expect(
        moduleState(one('learners/x.service.ts', 'let cache = new Map();')),
      ).toEqual([]);
    });

    it('sees the resolver fall through to anything but the store', () => {
      const { found } = resolverReferences(
        one(
          GUC_MODULE,
          [
            'function resolveTenantGucValues(): [string, string, string] {',
            "  const orgId = getCurrentOrganisationId() ?? lastOrg ?? '';",
            "  const userId = getCurrentUserId() ?? fallback.currentUserId ?? '';",
            "  return [orgId, userId, getRlsBootstrap() ? '1' : '0'];",
            '}',
          ].join('\n'),
        ),
      );
      expect(found).toEqual([
        `${GUC_MODULE}:2 lastOrg`,
        `${GUC_MODULE}:3 fallback`,
      ]);
    });
  });
});
