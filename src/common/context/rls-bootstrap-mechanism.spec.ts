import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * The RLS bootstrap flag is set in exactly one way: `withRlsBootstrap`.
 *
 * ── WHAT THIS REPLACED, AND WHY IT IS SMALLER ───────────────────────────────
 *
 * This file used to be `bootstrap-window-exclusivity.spec.ts`: a scan for a
 * window opened in the same function as a Promise.all, or a window-opening
 * function called inside one, with an allowlist and a list of nine findings
 * pending review. That rule policed *timing*, because `setRlsBootstrap(true)`
 * assigned the flag on the request's shared store and wrote a process-global
 * fallback the GUC resolver OR-ed in — so what else was in flight while a
 * window was open decided what bypassed.
 *
 * `withRlsBootstrap` runs its callback in a store of its own. Siblings keep
 * theirs, overlapping windows have nothing to restore, and nothing
 * process-global is written. `apply-tenant-gucs.spec.ts` proves each of those
 * at the GUC a statement actually sends, and
 * `test/employer-learner-access.e2e-spec.ts` proves it against the leak itself,
 * with the loaders back inside the profile's Promise.all. Timing is no longer a
 * way to get this wrong, so a rule about timing no longer earns its place.
 *
 * What remains is the question of *content* — which reads belong inside a
 * window — and that is not mechanical. A Promise.all inside a window is no
 * different from a sequence of reads inside one: every read in the callback
 * bypasses. That is reviewed against the rules on `withRlsBootstrap`, not
 * scanned for.
 *
 * ── WHAT THIS STILL ENFORCES ────────────────────────────────────────────────
 *
 * The one way to reintroduce the defect: setting the flag other than through
 * the helper. So, across every production file:
 *
 *   1. No `setRlsBootstrap`. It is gone; nothing may bring it back.
 *   2. No assignment to an `rlsBootstrap` property, and no object literal with
 *      an `rlsBootstrap` key, outside `correlation-id-context.ts` — which is
 *      what `store.rlsBootstrap = true`, or a store passed to
 *      `runWithCorrelationId` / `enterCorrelationContext`, would take.
 */

const SRC = join(__dirname, '..', '..');
const CONTEXT_MODULE = 'common/context/correlation-id-context.ts';

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

/** Every way a file sets the flag other than through the helper. */
function flagWrites(sources: ISource[]): string[] {
  const found: string[] = [];
  for (const { path, text } of sources) {
    const sourceFile = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const at = (node: ts.Node): string =>
      `${path}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === 'setRlsBootstrap') {
        found.push(`${at(node)} setRlsBootstrap`);
      }
      if (path !== CONTEXT_MODULE) {
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) &&
          node.left.name.text === 'rlsBootstrap'
        ) {
          found.push(`${at(node)} rlsBootstrap assignment`);
        }
        if (
          (ts.isPropertyAssignment(node) ||
            ts.isShorthandPropertyAssignment(node)) &&
          node.name.getText() === 'rlsBootstrap'
        ) {
          found.push(`${at(node)} rlsBootstrap key`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return found;
}

describe('the RLS bootstrap flag is set only by withRlsBootstrap', () => {
  const sources = productionSources();

  it('has windows to check', () => {
    // Guards the guard: a scan that read nothing would pass the test below.
    const windows = sources.reduce(
      (count, { text }) =>
        count + (text.match(/withRlsBootstrap\(/g) ?? []).length,
      0,
    );
    expect(windows).toBeGreaterThanOrEqual(40);
  });

  it('finds no other way of setting it in any production file', () => {
    expect(flagWrites(sources)).toEqual([]);
  });

  describe('the rule still bites', () => {
    const check = (text: string, path = 'learners/x.service.ts'): string[] =>
      flagWrites([{ path, text }]);

    it('sees the retired setter', () => {
      expect(check('setRlsBootstrap(true);')).toEqual([
        'learners/x.service.ts:1 setRlsBootstrap',
      ]);
    });

    it('sees the flag assigned on a store', () => {
      expect(check('store.rlsBootstrap = true;')).toEqual([
        'learners/x.service.ts:1 rlsBootstrap assignment',
      ]);
    });

    it('sees a store literal carrying the flag', () => {
      expect(
        check(
          "runWithCorrelationId({ correlationId: 'x', rlsBootstrap: true }, fn);",
        ),
      ).toEqual(['learners/x.service.ts:1 rlsBootstrap key']);
    });

    it('lets the context module build the derived store', () => {
      expect(
        check(
          'storage.run({ ...current, rlsBootstrap: true }, fn);',
          CONTEXT_MODULE,
        ),
      ).toEqual([]);
    });

    it('passes the helper and a read of the flag', () => {
      expect(
        check(
          'await withRlsBootstrap(() => repo.find()); const on = getRlsBootstrap();',
        ),
      ).toEqual([]);
    });
  });
});
