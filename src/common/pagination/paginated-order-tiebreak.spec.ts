import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * Every paged query orders on something unique.
 *
 * ── THE DEFECT THIS STOPS ───────────────────────────────────────────────────
 *
 * Offset pages are separate queries. When the ORDER BY has ties — rows that
 * share a `createdAt` because they were written in one transaction, where
 * now() is the transaction's start; reviews booked in the same slot; a DAS
 * payment run that dates every payment alike — Postgres may return the tied
 * rows in a different order on each query. Page 2 then repeats some of page
 * 1 and never shows others. Nothing errors. The roster lost enrolments to
 * exactly this (F1.2.1 AC7). On its first run this rule found twenty-seven
 * more: twenty-one paged lists, and six "latest N" reads (`take` without
 * `skip`) whose cut fell arbitrarily through a tie. Two in-memory pages had
 * the same shape.
 *
 * The fix is one term: end the order on the primary key. This rule makes it
 * mechanical, the way `rls-bootstrap-mechanism.spec.ts` does for the bypass
 * flag: a query that pages (`skip`/`take`, in find options or on a query
 * builder) must have an order whose terms include `id`.
 *
 * ── WHAT IT READS ───────────────────────────────────────────────────────────
 *
 *   find options   an object literal with `skip` or `take` must have an
 *                  `order` whose keys include `id`
 *   query builder  a `.skip(` or `.take(` call; every `orderBy` /
 *                  `addOrderBy` on the same builder in the same function
 *                  (followed through `.clone()` and the variable it was
 *                  assigned to) must between them name an `id` column
 *
 * A dynamic sort column (a variable passed to `orderBy`) is not a tiebreak;
 * the `id` term still has to follow it.
 *
 * ── WHAT IT CANNOT READ ─────────────────────────────────────────────────────
 *
 * A list sorted in memory and sliced into pages has no `skip`/`take` to find.
 * Those are caught the other way round: a function that builds pagination
 * meta without paging in SQL is an in-memory page, and it must be on the
 * list below, which names where its tiebreak is. A new one fails here until
 * someone has looked.
 */

const SRC = join(__dirname, '..', '..');

interface ISource {
  path: string;
  text: string;
}

/** In-memory pages, each with its tiebreak checked by hand and named. */
const IN_MEMORY_PAGES: ReadonlyMap<string, string> = new Map([
  [
    'learners/learner-cohort.service.ts#list',
    'applySort ends every comparison on enrolmentId; loadActiveEnrolments orders by createdAt, id',
  ],
  [
    'reporting/employer-directory.service.ts#list',
    'sorted by organisationName, then employerOrganisationId',
  ],
]);

function productionSources(): ISource[] {
  const sources: ISource[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'migrations') continue;
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

const ORDER_METHODS = new Set(['orderBy', 'addOrderBy']);
const PAGE_METHODS = new Set(['skip', 'take', 'offset', 'limit']);

/** The column a sort term names: `audit.createdAt` → createdAt. */
function columnOf(term: string): string {
  const bare = term.replace(/["`\s]/g, '');
  const dot = bare.lastIndexOf('.');
  return dot >= 0 ? bare.slice(dot + 1) : bare;
}

function isIdTerm(term: string): boolean {
  return columnOf(term) === 'id';
}

/** The terms an orderBy/addOrderBy call sorts on, as far as the source says. */
function orderTermsOf(call: ts.CallExpression): string[] {
  const [first] = call.arguments;
  if (!first) return [];
  if (ts.isStringLiteralLike(first)) return [first.text];
  // `${alias}.id`: the column is whatever the template ends on.
  if (ts.isTemplateExpression(first)) {
    const spans = first.templateSpans;
    return [spans[spans.length - 1].literal.text || `<${first.getText()}>`];
  }
  if (ts.isObjectLiteralExpression(first)) {
    return first.properties
      .filter(ts.isPropertyAssignment)
      .map((p) =>
        ts.isStringLiteralLike(p.name) || ts.isIdentifier(p.name)
          ? p.name.text
          : p.name.getText(),
      );
  }
  // A variable or expression: whatever it sorts on, it is not a known id.
  return [`<${first.getText()}>`];
}

/** Walks a call chain down to what it hangs off: an identifier, or the call that started it. */
function chainRoot(node: ts.Expression): ts.Expression {
  let current: ts.Expression = node;
  for (;;) {
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        if (name === 'createQueryBuilder') return current;
        current = callee.expression;
        continue;
      }
      return current;
    }
    if (ts.isPropertyAccessExpression(current)) {
      // `this.repo` style roots stay as they are; a property of a builder
      // variable is not something this walks through.
      return current;
    }
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current) || ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/** Every call in a chain, from its root out to `node`. */
function callsInChain(node: ts.Expression): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  let current: ts.Expression = node;
  while (ts.isCallExpression(current)) {
    calls.push(current);
    const callee = current.expression;
    if (!ts.isPropertyAccessExpression(callee)) break;
    if (callee.name.text === 'createQueryBuilder') break;
    current = callee.expression;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
    }
  }
  return calls;
}

function methodName(call: ts.CallExpression): string | null {
  return ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : null;
}

function enclosingFunction(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isConstructorDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

function functionName(fn: ts.Node): string {
  let current: ts.Node | undefined = fn;
  while (current) {
    if (
      (ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }
    current = current.parent;
  }
  return '<anonymous>';
}

/**
 * The identifiers a builder variable was built from: `const b = a.clone()`
 * makes `a` part of `b`'s order, since orderBy on `a` before cloning carries.
 */
function aliasesOf(root: string, fn: ts.Node): Set<string> {
  const names = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        names.has(node.name.text) &&
        node.initializer
      ) {
        const base = chainRoot(node.initializer);
        if (ts.isIdentifier(base) && !names.has(base.text)) {
          names.add(base.text);
          grew = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fn);
  }
  return names;
}

/** Order terms applied to any of `names` anywhere in `fn`, initialisers included. */
function orderTermsForBuilder(names: Set<string>, fn: ts.Node): string[] {
  const terms: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = methodName(node);
      if (name && ORDER_METHODS.has(name)) {
        const base = chainRoot(node);
        if (ts.isIdentifier(base) && names.has(base.text)) {
          terms.push(...orderTermsOf(node));
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      names.has(node.name.text) &&
      node.initializer
    ) {
      for (const call of callsInChain(
        ts.isAwaitExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer,
      )) {
        const name = methodName(call);
        if (name && ORDER_METHODS.has(name)) terms.push(...orderTermsOf(call));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return terms;
}

/** Paged queries whose order has no `id` term. */
function untiedPagedQueries(sources: ISource[]): string[] {
  const found = new Set<string>();
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
      // find / findAndCount options: { skip?, take?, order? }
      if (ts.isObjectLiteralExpression(node)) {
        const keys = new Map<string, ts.ObjectLiteralElementLike>();
        for (const p of node.properties) {
          if (
            (ts.isPropertyAssignment(p) ||
              ts.isShorthandPropertyAssignment(p)) &&
            p.name
          ) {
            keys.set(p.name.getText(), p);
          }
        }
        if (keys.has('skip') || keys.has('take')) {
          const order = keys.get('order');
          let terms: string[] = [];
          if (
            order &&
            ts.isPropertyAssignment(order) &&
            ts.isObjectLiteralExpression(order.initializer)
          ) {
            terms = order.initializer.properties
              .filter(ts.isPropertyAssignment)
              .map((p) => p.name.getText().replace(/['"]/g, ''));
          } else if (order) {
            terms = [`<${order.getText()}>`];
          }
          if (!terms.some(isIdTerm)) {
            found.add(
              `${at(node)} find options: order ${terms.length ? terms.join(', ') : 'missing'}`,
            );
          }
        }
      }

      // Query builder: .skip( / .take( / .offset( / .limit(
      if (ts.isCallExpression(node)) {
        const name = methodName(node);
        if (name && PAGE_METHODS.has(name)) {
          const callee = node.expression as ts.PropertyAccessExpression;
          const base = chainRoot(callee.expression);
          const fn = enclosingFunction(node);
          let terms: string[];
          if (ts.isIdentifier(base)) {
            terms = orderTermsForBuilder(aliasesOf(base.text, fn), fn);
          } else {
            terms = callsInChain(callee.expression)
              .filter((c) => {
                const m = methodName(c);
                return m !== null && ORDER_METHODS.has(m);
              })
              .flatMap(orderTermsOf);
          }
          // Only builder chains: `array.slice`-like calls named take/limit on
          // things that were never ordered are not queries.
          const isBuilder =
            terms.length > 0 ||
            text
              .slice(fn.getStart(), fn.getEnd())
              .includes('createQueryBuilder') ||
            text.slice(fn.getStart(), fn.getEnd()).includes('QueryBuilder');
          if (isBuilder && !terms.some(isIdTerm)) {
            found.add(
              `${at(callee.name)} .${name}(): order ${terms.length ? terms.join(', ') : 'missing'}`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return [...found].sort();
}

/**
 * Functions that build pagination meta but page nowhere in SQL: pages cut
 * from an array. Returned as `path#function`.
 */
function inMemoryPages(sources: ISource[]): string[] {
  const found = new Set<string>();
  for (const { path, text } of sources) {
    if (!text.includes('buildPaginationMeta(')) continue;
    const sourceFile = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'buildPaginationMeta'
      ) {
        const fn = enclosingFunction(node);
        const body = text.slice(fn.getStart(), fn.getEnd());
        const pagesInSql =
          /\.skip\(|\.take\(|\bskip:|\btake:|\.offset\(|\.limit\(/.test(body);
        if (!pagesInSql && /\.slice\(/.test(body)) {
          found.add(`${path}#${functionName(fn)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return [...found].sort();
}

describe('paged queries order on something unique', () => {
  const sources = productionSources();

  it('has paged queries to check', () => {
    // Guards the guard: a scan that read nothing would pass everything below.
    const paged = sources.reduce(
      (count, { text }) =>
        count + (text.match(/\.skip\(|\bskip:|\.take\(|\btake:/g) ?? []).length,
      0,
    );
    expect(paged).toBeGreaterThanOrEqual(25);
  });

  it('finds no paged query whose order lacks an id tiebreak', () => {
    expect(untiedPagedQueries(sources)).toEqual([]);
  });

  it('finds no in-memory page that has not been checked by hand', () => {
    expect(inMemoryPages(sources)).toEqual([...IN_MEMORY_PAGES.keys()].sort());
  });

  describe('the rule still bites', () => {
    const check = (text: string): string[] =>
      untiedPagedQueries([{ path: 'x/x.service.ts', text }]);

    /**
     * Verbatim from `programmes/programmes.service.ts` findAll as it stood
     * before this rule landed — one of the twenty-seven sites it found on its
     * first run — and then the same file as it is now.
     */
    const PROGRAMMES_BEFORE = `
  async findAll(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<Programme>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await this.programmeRepo.findAndCount({
      where: { organisationId: user.organisationId! },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return new PaginatedResult(
      items,
      buildPaginationMeta({ total, page, perPage }),
    );
  }`;

    it('flags the real programmes list as it was', () => {
      expect(check(PROGRAMMES_BEFORE)).toEqual([
        'x/x.service.ts:8 find options: order createdAt',
      ]);
    });

    it('passes the real programmes list as it is', () => {
      const path = 'programmes/programmes.service.ts';
      expect(
        untiedPagedQueries([
          { path, text: readFileSync(join(SRC, path), 'utf8') },
        ]),
      ).toEqual([]);
    });

    it('passes find options that end on id', () => {
      expect(
        check(
          `repo.findAndCount({ order: { createdAt: 'DESC', id: 'DESC' }, skip: 0, take: 20 });`,
        ),
      ).toEqual([]);
    });

    it('flags find options with no order at all', () => {
      expect(check(`repo.find({ where: {}, take: 20 });`)).toEqual([
        'x/x.service.ts:1 find options: order missing',
      ]);
    });

    it('flags a builder chain ordered on a timestamp alone', () => {
      expect(
        check(`
function list() {
  return this.repo.createQueryBuilder('n')
    .orderBy('n.createdAt', 'DESC')
    .skip(0)
    .take(20)
    .getManyAndCount();
}`),
      ).toEqual([
        'x/x.service.ts:5 .skip(): order n.createdAt',
        'x/x.service.ts:6 .take(): order n.createdAt',
      ]);
    });

    it('follows a builder variable across statements', () => {
      expect(
        check(`
function list() {
  const qb = this.repo.createQueryBuilder('r');
  if (x) qb.andWhere('r.x = 1');
  qb.orderBy('r.scheduledAt', 'ASC').skip(0).take(20);
  return qb.getManyAndCount();
}`),
      ).toEqual([
        'x/x.service.ts:5 .skip(): order r.scheduledAt',
        'x/x.service.ts:5 .take(): order r.scheduledAt',
      ]);
      expect(
        check(`
function list() {
  const qb = this.repo.createQueryBuilder('r');
  qb.orderBy('r.scheduledAt', 'ASC').addOrderBy('r.id', 'ASC').skip(0).take(20);
  return qb.getManyAndCount();
}`),
      ).toEqual([]);
    });

    it('follows a clone back to the builder it came from', () => {
      expect(
        check(`
function list() {
  const scoped = this.repo.createQueryBuilder('a');
  return scoped.clone().orderBy('a.createdAt', 'DESC').addOrderBy('a.id', 'DESC').take(10).getMany();
}`),
      ).toEqual([]);
    });

    it('does not accept a dynamic sort column as a tiebreak', () => {
      expect(
        check(`
function list() {
  const qb = this.repo.createQueryBuilder('a');
  qb.orderBy(sortColumn, 'ASC').skip(0).take(20);
}`),
      ).toEqual([
        'x/x.service.ts:4 .skip(): order <sortColumn>',
        'x/x.service.ts:4 .take(): order <sortColumn>',
      ]);
    });

    it('finds an in-memory page that is not on the checked list', () => {
      expect(
        inMemoryPages([
          {
            path: 'x/x.service.ts',
            text: `
class X {
  list(rows: unknown[], page: number, perPage: number) {
    const meta = buildPaginationMeta({ total: rows.length, page, perPage });
    return rows.slice((page - 1) * perPage, page * perPage);
  }
}`,
          },
        ]),
      ).toEqual(['x/x.service.ts#list']);
    });
  });
});
