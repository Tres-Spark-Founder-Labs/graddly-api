import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * A bootstrap window may contain only reads that are meant to bypass.
 *
 * ── WHY THIS IS A SOURCE SCAN ───────────────────────────────────────────────
 *
 * `setRlsBootstrap(true)` sets a request-global flag. Whatever else the request
 * has in flight while it is set runs with `app_rls_bootstrap()` true, so how
 * few lines a window spans says nothing; what matters is what runs beside it.
 * The rule is on `setRlsBootstrap` and in `docs/employer-learner-access.md`,
 * and a rule nothing enforces is how the transfer bypass got into the
 * middleware — so this reads the source, the technique
 * `rls-bootstrap.middleware.spec.ts` uses for the bypass list.
 *
 * ── TWO SHAPES, BECAUSE ONE WOULD NOT HAVE CAUGHT THE LEAK ──────────────────
 *
 *   A  `setRlsBootstrap(true)` in the same function as a `Promise.all`.
 *      Allowed only by name, with a reason, where every read in the batch is
 *      itself a bypassing read.
 *
 *   B  A function that opens a window, called inside a `Promise.all`.
 *      This is the shape that leaked, twice: the window opened inside
 *      `loadTutorNames` / `loadOrganisationNames`, and the `Promise.all` sat in
 *      the caller. Shape A alone passes both. B also catches two windows
 *      opened at once, which can restore out of order and leave the flag on.
 *
 * `this.name()` resolves to a window-opener in the same file only, so a
 * service's own private method of the same name as another service's loader
 * (commitment-board's `loadOrganisationNames`) is not mistaken for it. A call
 * through another object resolves by name against every file.
 *
 * ── SCOPE: REQUEST PATHS ────────────────────────────────────────────────────
 *
 * Cron and background work that runs a whole job as a system actor is a
 * different category, and is excluded BY PATH: `scheduler/`, `bullmq/`,
 * `migrations/`, and any `*.processor.ts`. A background method that lives in a
 * request-path service file is not excluded — the path cannot tell — and is
 * reported like anything else.
 */

const SRC = join(__dirname, '..', '..');

const BACKGROUND_PATHS: readonly RegExp[] = [
  /^scheduler\//,
  /^bullmq\//,
  /^migrations\//,
  /\.processor\.ts$/,
];

const isBackground = (file: string): boolean =>
  BACKGROUND_PATHS.some((pattern) => pattern.test(file));

/**
 * Deliberate: the entire batch inside the window is the bypassing read.
 * Every entry carries a one-line reason.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  [
    'enrolments/enrolments.service.ts#enrichEnrolmentsForDisplay',
    'every read in the batch is display hydration: apprentice, standard, user and organisation labels',
  ],
]);

/**
 * Found by this rule on 2026-09-16 and REPORTED, NOT FIXED, pending review.
 *
 * This is not an allowlist. No entry here has been judged safe; each is a
 * finding someone has to decide. The list exists so the build stays green
 * while that happens, and it can only shrink: an entry that stops being
 * found fails the "only shrinks" test until it is removed, and anything new
 * fails the main test.
 */
const REPORTED_PENDING_REVIEW: readonly string[] = Object.freeze([
  'enrolments/enrolments.service.ts#getParticipantOptions -> loadApprenticeUserCandidates',
  'enrolments/enrolments.service.ts#getParticipantOptions -> loadOrgMemberOptions',
  'learners/intervention-queue.service.ts#list -> loadEmployerContacts',
  'learners/intervention-queue.service.ts#list -> loadTutorNames',
  'ofsted/qip-actions.service.ts#buildPlanContent',
  'reporting/employer-directory.service.ts#list -> loadEmployers',
  'reporting/employer-directory.service.ts#list -> loadOwnerMemberships',
  'reporting/levy-roi-report.service.ts#buildPdfContent -> loadOrganisationWithBootstrap',
  'reporting/levy-roi-report.service.ts#buildProviderComparisonContent -> loadOrganisationWithBootstrap',
]);

interface ISource {
  path: string;
  text: string;
}

interface IContainer {
  file: string;
  name: string;
  opens: boolean;
  batches: ts.CallExpression[];
}

function containerName(node: ts.Node): string | null {
  if (
    (ts.isMethodDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isGetAccessorDeclaration(node)) &&
    node.body
  ) {
    return node.name ? node.name.getText() : '<anonymous>';
  }
  if (ts.isConstructorDeclaration(node) && node.body) {
    return 'constructor';
  }
  // A module-scope `const helper = async () => {…}`.
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer)) &&
    ts.isVariableStatement(node.parent.parent) &&
    ts.isSourceFile(node.parent.parent.parent)
  ) {
    return node.name.getText();
  }
  return null;
}

function opensWindow(call: ts.CallExpression): boolean {
  const callee = call.expression;
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : null;
  return (
    name === 'setRlsBootstrap' &&
    call.arguments.length === 1 &&
    call.arguments[0].kind === ts.SyntaxKind.TrueKeyword
  );
}

function isBatch(call: ts.CallExpression): boolean {
  const callee = call.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Promise' &&
    ['all', 'allSettled'].includes(callee.name.text)
  );
}

function collectContainers(sources: ISource[]): IContainer[] {
  const containers: IContainer[] = [];
  for (const { path, text } of sources) {
    const sourceFile = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const stack: IContainer[] = [];
    const visit = (node: ts.Node): void => {
      const name = containerName(node);
      if (name !== null) {
        stack.push({ file: path, name, opens: false, batches: [] });
      }
      if (ts.isCallExpression(node) && stack.length > 0) {
        const top = stack[stack.length - 1];
        if (opensWindow(node)) top.opens = true;
        if (isBatch(node)) top.batches.push(node);
      }
      ts.forEachChild(node, visit);
      if (name !== null) {
        const done = stack.pop();
        if (done) containers.push(done);
      }
    };
    visit(sourceFile);
  }
  return containers;
}

/** Every finding, as `file#function` (A) or `file#function -> opener` (B). */
function findBootstrapConcurrency(sources: ISource[]): string[] {
  const containers = collectContainers(sources);

  const openersByFile = new Map<string, Set<string>>();
  const openerNames = new Set<string>();
  for (const container of containers.filter((c) => c.opens)) {
    const names = openersByFile.get(container.file) ?? new Set<string>();
    names.add(container.name);
    openersByFile.set(container.file, names);
    openerNames.add(container.name);
  }

  const findings = new Set<string>();
  for (const container of containers) {
    const where = `${container.file}#${container.name}`;
    if (container.opens && container.batches.length > 0) {
      findings.add(where);
    }

    for (const batch of container.batches) {
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          let opener: string | null = null;
          if (
            ts.isPropertyAccessExpression(callee) &&
            callee.expression.kind === ts.SyntaxKind.ThisKeyword
          ) {
            // `this.name()` — this class's own method, so this file only.
            if (openersByFile.get(container.file)?.has(callee.name.text)) {
              opener = callee.name.text;
            }
          } else if (ts.isPropertyAccessExpression(callee)) {
            // `this.someService.name()` — another object, by name.
            if (openerNames.has(callee.name.text)) opener = callee.name.text;
          } else if (ts.isIdentifier(callee)) {
            if (openersByFile.get(container.file)?.has(callee.text)) {
              opener = callee.text;
            }
          }
          if (opener !== null && opener !== container.name) {
            findings.add(`${where} -> ${opener}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(batch);
    }
  }

  return [...findings].sort();
}

function requestPathSources(): ISource[] {
  const sources: ISource[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
        continue;
      }
      const path = relative(SRC, full).split(sep).join('/');
      if (isBackground(path)) continue;
      const text = readFileSync(full, 'utf8');
      // Only files that open a window or run a batch can take part.
      if (text.includes('setRlsBootstrap(') || text.includes('Promise.all')) {
        sources.push({ path, text });
      }
    }
  };
  walk(SRC);
  return sources;
}

describe('bootstrap windows are exclusive', () => {
  const sources = requestPathSources();
  const findings = findBootstrapConcurrency(sources);

  it('has window-opening request-path code to check', () => {
    // Guards the guard: a scan that read nothing would pass every test below.
    const openers = collectContainers(sources).filter((c) => c.opens);
    expect(openers.length).toBeGreaterThanOrEqual(20);
  });

  it('finds nothing that is neither allowed with a reason nor already reported', () => {
    const accounted = new Set([...ALLOWED.keys(), ...REPORTED_PENDING_REVIEW]);
    expect(findings.filter((finding) => !accounted.has(finding))).toEqual([]);
  });

  it('gives every allowlist entry a one-line reason', () => {
    for (const reason of ALLOWED.values()) {
      expect(reason.trim()).toMatch(/^[^\n]{10,200}$/);
    }
  });

  it('holds no stale allowlist entry', () => {
    for (const key of ALLOWED.keys()) {
      expect(findings).toContain(key);
    }
  });

  it('lets the reported list only shrink — remove an entry once it is fixed', () => {
    for (const key of REPORTED_PENDING_REVIEW) {
      expect(findings).toContain(key);
    }
  });

  it('never both allows and reports the same finding', () => {
    for (const key of REPORTED_PENDING_REVIEW) {
      expect(ALLOWED.has(key)).toBe(false);
    }
  });

  it('excludes background work by path, and nothing else', () => {
    expect(isBackground('scheduler/das-sync-cron.service.ts')).toBe(true);
    expect(isBackground('bullmq/processors/pdf-generation.processor.ts')).toBe(
      true,
    );
    expect(isBackground('ilr/ilr-submit.processor.ts')).toBe(true);
    expect(isBackground('migrations/1781100000056-X.ts')).toBe(true);
    expect(isBackground('learners/tutor-caseload.service.ts')).toBe(false);
    expect(isBackground('learners/learner-profile.service.ts')).toBe(false);
  });

  /**
   * Each shape proved against the exact source it was written for. A scan
   * that matched nothing would otherwise look like a codebase with nothing
   * wrong in it.
   */
  describe('the rule still bites', () => {
    const metrics: ISource = {
      path: 'learners/learner-metrics.service.ts',
      text: `
        export class LearnerMetricsService {
          async loadTutorNames(ids: string[]) {
            const previous = getRlsBootstrap();
            setRlsBootstrap(true);
            try { return await this.userRepo.find(); }
            finally { setRlsBootstrap(previous); }
          }
        }`,
    };

    it('sees the shape that leaked: a loader beside a scoped read in a Promise.all', () => {
      const profile: ISource = {
        path: 'learners/learner-profile.service.ts',
        text: `
          export class LearnerProfileService {
            async getProfile() {
              const [documents, names] = await Promise.all([
                this.documentsService.listForEnrolment(org, id),
                this.metricsService.loadTutorNames([tutorId]),
              ]);
            }
          }`,
      };
      expect(findBootstrapConcurrency([metrics, profile])).toEqual([
        'learners/learner-profile.service.ts#getProfile -> loadTutorNames',
      ]);
    });

    it('passes the fix: the loader sequenced after the batch', () => {
      const profile: ISource = {
        path: 'learners/learner-profile.service.ts',
        text: `
          export class LearnerProfileService {
            async getProfile() {
              const [documents] = await Promise.all([
                this.documentsService.listForEnrolment(org, id),
              ]);
              const names = await this.metricsService.loadTutorNames([tutorId]);
            }
          }`,
      };
      expect(findBootstrapConcurrency([metrics, profile])).toEqual([]);
    });

    it('sees two windows opened at once', () => {
      const queue: ISource = {
        path: 'learners/intervention-queue.service.ts',
        text: `
          export class InterventionQueueService {
            async list() {
              await Promise.all([
                this.metricsService.loadTutorNames(a),
                this.metricsService.loadTutorNames(b),
              ]);
            }
          }`,
      };
      expect(findBootstrapConcurrency([metrics, queue])).toEqual([
        'learners/intervention-queue.service.ts#list -> loadTutorNames',
      ]);
    });

    it('sees setRlsBootstrap(true) in the same function as a Promise.all', () => {
      const enrich: ISource = {
        path: 'enrolments/enrolments.service.ts',
        text: `
          export class EnrolmentsService {
            async enrichEnrolmentsForDisplay() {
              setRlsBootstrap(true);
              try { await Promise.all([this.a.find(), this.b.find()]); }
              finally { setRlsBootstrap(false); }
            }
          }`,
      };
      expect(findBootstrapConcurrency([enrich])).toEqual([
        'enrolments/enrolments.service.ts#enrichEnrolmentsForDisplay',
      ]);
    });

    it('does not count setRlsBootstrap(false) as opening a window', () => {
      const closing: ISource = {
        path: 'x/closing.service.ts',
        text: `
          export class Closing {
            async run() {
              setRlsBootstrap(false);
              await Promise.all([this.a.find(), this.b.find()]);
            }
          }`,
      };
      expect(findBootstrapConcurrency([closing])).toEqual([]);
    });

    it('does not mistake a same-named private method for another service’s loader', () => {
      const board: ISource = {
        path: 'commitments/commitment-board.service.ts',
        text: `
          export class CommitmentBoardService {
            async getBoard() {
              await Promise.all([this.loadOrganisationNames(ids), this.x()]);
            }
            private async loadOrganisationNames(ids: string[]) {
              return this.organisationRepo.find();
            }
          }`,
      };
      const openerElsewhere: ISource = {
        path: 'learners/learner-metrics.service.ts',
        text: `
          export class LearnerMetricsService {
            async loadOrganisationNames(ids: string[]) {
              setRlsBootstrap(true);
              try { return await this.organisationRepo.find(); }
              finally { setRlsBootstrap(false); }
            }
          }`,
      };
      expect(findBootstrapConcurrency([board, openerElsewhere])).toEqual([]);
    });
  });
});
