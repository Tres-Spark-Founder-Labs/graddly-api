/**
 * Demo content for features the reset seed leaves empty — additive, and safe
 * to point at a deployed database.
 *
 * ── WHY A SECOND SCRIPT AND NOT MORE OF `seed-test-data.ts` ─────────────────
 *
 * `seed-test-data.ts` is a *reset*: it issues `DELETE FROM users` and eight
 * other tables and refuses any host but a local one, for exactly that reason.
 * It can never run against a deployed environment, so anything it seeds is
 * local-only by construction.
 *
 * This follows `seed-flow-portal.ts` instead, which is the additive pattern in
 * this repository:
 *
 *   1. it never DELETEs;
 *   2. every write is an upsert keyed on a natural identifier, so a second run
 *      changes nothing;
 *   3. a non-local host must be named on purpose through `SEED_REMOTE_HOST`,
 *      because "wherever DATABASE_URL happens to point" is how the wrong
 *      database gets written to.
 *
 * ── AND ONE RULE THIS SCRIPT ADDS ───────────────────────────────────────────
 *
 * It touches only rows it created itself, inside organisations it owns by
 * slug (`gradlly-demo-*`). It never looks for "an enrolment to attach demo
 * content to", because on a deployed database that enrolment belongs to a
 * real person: a fabricated EPA result or break in learning written onto a
 * real learner's record is worse than an empty screen. Everything below hangs
 * off the demo tenant or is not written at all.
 *
 * ── WHAT IT FILLS, AND WHY THESE ────────────────────────────────────────────
 *
 * The four tables the existing seed leaves empty while the screens that read
 * them are built:
 *
 *   break_in_learning        F2.2.4. The reset seed labels a learner "Break in
 *                            learning" and creates no row, so the label is
 *                            fiction. This creates a *closed* break — started
 *                            and returned from, with both actors recorded —
 *                            because a completed enrolment cannot also be on
 *                            an open break. An open one needs an active
 *                            enrolment and is not seeded here.
 *   epa_outcomes             The assessment result. Three learners reach
 *                            `completed` in the reset seed with no outcome
 *                            recorded against any of them.
 *   review_records           F2.2.3. A held review with its form payload and
 *   review_signatures        all three parties' signatures, which is what the
 *                            review detail screen renders.
 *   enrolment_ksb_coverage   F3.3.2. The reset seed's own header claims it
 *                            seeds this. It does not, so the heatmap has
 *                            evidence mappings and no assessments.
 *
 * ── RUNNING IT ──────────────────────────────────────────────────────────────
 *
 * Local:
 *   npx nest build
 *   SEED_ALLOW=yes node dist/scripts/seed-demo-content.js
 *
 * Deployed — the host must match what the connection actually resolves to:
 *   SEED_ALLOW=yes \
 *   SEED_REMOTE_HOST=<the exact host from your connection string> \
 *   DATABASE_URL=<connection string> \
 *   node dist/scripts/seed-demo-content.js
 *
 * Run `migration:run` against that database first. This script writes columns
 * that recent migrations added, and a database behind on them fails here with
 * a missing-column error rather than anything helpful.
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';

import { Apprentice } from '../src/apprentices/entities/apprentice.entity.js';
import { ApprenticeStatus } from '../src/apprentices/enums/apprentice-status.enum.js';
import AppDataSource from '../src/config/data-source.js';
import { BreakInLearning } from '../src/enrolments/entities/break-in-learning.entity.js';
import { Enrolment } from '../src/enrolments/entities/enrolment.entity.js';
import { EpaOutcomeRecord } from '../src/enrolments/entities/epa-outcome.entity.js';
import { EnrolmentStatus } from '../src/enrolments/enums/enrolment-status.enum.js';
import { EpaOutcome } from '../src/enrolments/enums/epa-outcome.enum.js';
import { OrganisationMembership } from '../src/organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../src/organisations/entities/organisation.entity.js';
import { MembershipStatus } from '../src/organisations/membership-status.enum.js';
import { OrganisationRole } from '../src/organisations/organisation-role.enum.js';
import { PortalType } from '../src/organisations/portal-type.enum.js';
import { EnrolmentKsbCoverage } from '../src/portfolio/entities/enrolment-ksb-coverage.entity.js';
import { KsbDefinition } from '../src/portfolio/entities/ksb-definition.entity.js';
import { KsbCoverageAssessment } from '../src/portfolio/enums/ksb-coverage-assessment.enum.js';
import { KsbKind } from '../src/portfolio/enums/ksb-kind.enum.js';
import { Programme } from '../src/programmes/entities/programme.entity.js';
import { Standard } from '../src/programmes/entities/standard.entity.js';
import { ReviewRecord } from '../src/reviews/entities/review-record.entity.js';
import { ReviewSignature } from '../src/reviews/entities/review-signature.entity.js';
import { Review } from '../src/reviews/entities/review.entity.js';
import { ReviewSignatureStatus } from '../src/reviews/enums/review-signature-status.enum.js';
import { ReviewSignerParty } from '../src/reviews/enums/review-signer-party.enum.js';
import { ReviewStatus } from '../src/reviews/enums/review-status.enum.js';
import { User } from '../src/users/entities/user.entity.js';

import type { EntityManager } from 'typeorm';

// ─── The demo tenant ─────────────────────────────────────────────────────────

/**
 * Two organisations, owned by this script and identified by slug. Nothing
 * outside these is read or written.
 */
const PROVIDER = {
  slug: 'gradlly-demo-provider',
  name: 'Ashford Demo Training Ltd',
  portalType: PortalType.PROVIDER,
  city: 'Manchester',
  postcode: 'M1 2AB',
  contact: {
    firstName: 'Ruth',
    lastName: 'Maguire',
    email: 'r.maguire@ashforddemo.ac.uk',
    password: 'AshfordDemo2026!',
    jobTitle: 'Head of Apprenticeships',
  },
};

const EMPLOYER = {
  slug: 'gradlly-demo-employer',
  name: 'Calder Demo Manufacturing Ltd',
  portalType: PortalType.EMPLOYER,
  city: 'Halifax',
  postcode: 'HX1 3RR',
  contact: {
    firstName: 'Stephen',
    lastName: 'Ayodele',
    email: 's.ayodele@calderdemo.co.uk',
    password: 'CalderDemo2026!',
    jobTitle: 'Operations Manager',
  },
};

/**
 * The learner. One enrolment carries all four states, because they are not
 * mutually exclusive on a real record: a learner can have had a break, hold
 * assessed KSBs, have a signed review behind them and an EPA result.
 *
 * The standard is the register's, checked 23 September 2026:
 * https://skillsengland.education.gov.uk/apprenticeships/ST0457
 */
const LEARNER = {
  firstName: 'Nadia',
  lastName: 'Kowalczyk',
  email: 'n.kowalczyk@calderdemo.co.uk',
  password: 'NadiaDemo2026!',
  standardCode: 'ST0457',
  standardTitle: 'Engineering technician',
  standardLevel: 3,
  fundingBandMax: 26000,
  durationMonths: 42,
};

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'db',
  'postgres',
]);

function resolveHost(): string {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '(unparseable DATABASE_URL)';
    }
  }
  return process.env.DB_HOST ?? 'localhost';
}

/**
 * `NODE_ENV` is deliberately not consulted: this repository's `.env` carries
 * `NODE_ENV=production` on a developer machine pointed at 127.0.0.1, so it
 * describes the build, not the database. Trusting it would refuse local runs
 * and wave through remote ones.
 */
function assertAllowed(host: string): void {
  if (process.env.SEED_ALLOW !== 'yes') {
    throw new Error('Refusing to run without SEED_ALLOW=yes');
  }
  if (LOCAL_HOSTS.has(host)) return;

  const confirmed = process.env.SEED_REMOTE_HOST;
  if (!confirmed) {
    throw new Error(
      `Database host "${host}" is not local. This script only ever adds rows ` +
        `inside its own demo organisations, but the target must be named on ` +
        `purpose: re-run with SEED_REMOTE_HOST="${host}".`,
    );
  }
  if (confirmed !== host) {
    throw new Error(
      `SEED_REMOTE_HOST="${confirmed}" does not match the host this ` +
        `connection resolves to ("${host}"). Refusing — that mismatch is what ` +
        `a stale environment variable looks like.`,
    );
  }
}

// ─── Upserts ─────────────────────────────────────────────────────────────────

const summary = {
  organisations: 0,
  users: 0,
  memberships: 0,
  programmes: 0,
  standards: 0,
  ksbDefinitions: 0,
  apprentices: 0,
  enrolments: 0,
  reviews: 0,
  reviewRecords: 0,
  reviewSignatures: 0,
  breaksInLearning: 0,
  epaOutcomes: 0,
  ksbCoverage: 0,
};

async function upsertOrganisation(
  m: EntityManager,
  spec: typeof PROVIDER,
): Promise<Organisation> {
  const existing = await m.findOne(Organisation, {
    where: { slug: spec.slug },
  });
  if (existing) {
    // The one field that decides whether a portal can see the organisation at
    // all, repaired in case the row predates this script.
    if (existing.portalType !== spec.portalType) {
      existing.portalType = spec.portalType;
      await m.save(existing);
    }
    return existing;
  }
  summary.organisations += 1;
  return m.save(
    m.create(Organisation, {
      name: spec.name,
      slug: spec.slug,
      portalType: spec.portalType,
      city: spec.city,
      postcode: spec.postcode,
      address: 'Demo address',
      country: 'United Kingdom',
      orgEmail: spec.contact.email,
    }),
  );
}

async function upsertUser(
  m: EntityManager,
  spec: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    jobTitle?: string;
  },
): Promise<User> {
  const existing = await m.findOne(User, { where: { email: spec.email } });
  if (existing) return existing;
  summary.users += 1;
  return m.save(
    m.create(User, {
      firstName: spec.firstName,
      lastName: spec.lastName,
      email: spec.email,
      password: await bcrypt.hash(spec.password, 10),
      // Verified on purpose: login refuses an unverified address, and there is
      // no inbox to click through on a demo tenant.
      isEmailVerified: true,
      isActive: true,
      jobTitle: spec.jobTitle ?? null,
    }),
  );
}

async function upsertMembership(
  m: EntityManager,
  user: User,
  org: Organisation,
  role: OrganisationRole,
): Promise<void> {
  const existing = await m.findOne(OrganisationMembership, {
    where: { user: { id: user.id }, organisation: { id: org.id } },
  });
  if (existing) return;
  summary.memberships += 1;
  await m.save(
    m.create(OrganisationMembership, {
      user: { id: user.id },
      organisation: { id: org.id },
      role,
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    }),
  );
}

async function upsertStandard(
  m: EntityManager,
  org: Organisation,
): Promise<Standard> {
  let programme = await m.findOne(Programme, {
    where: { organisationId: org.id, code: 'DEMO-ENG' },
  });
  if (!programme) {
    summary.programmes += 1;
    programme = await m.save(
      m.create(Programme, {
        organisationId: org.id,
        code: 'DEMO-ENG',
        title: 'Engineering apprenticeships (demo)',
      }),
    );
  }

  const existing = await m.findOne(Standard, {
    where: { organisationId: org.id, code: LEARNER.standardCode },
  });
  if (existing) return existing;

  summary.standards += 1;
  const standard = await m.save(
    m.create(Standard, {
      organisationId: org.id,
      programmeId: programme.id,
      code: LEARNER.standardCode,
      title: `${LEARNER.standardTitle} L${LEARNER.standardLevel}`,
      fundingBandMax: String(LEARNER.fundingBandMax),
      defaultDurationMonths: LEARNER.durationMonths,
    }),
  );

  // Six KSBs rather than the full framework: enough for the heatmap to show
  // every assessment state without pretending to be the real standard.
  const ksbs: { code: string; kind: KsbKind; title: string }[] = [
    { code: 'K1', kind: KsbKind.KNOWLEDGE, title: 'Engineering principles' },
    { code: 'K2', kind: KsbKind.KNOWLEDGE, title: 'Health and safety law' },
    { code: 'S1', kind: KsbKind.SKILL, title: 'Reading engineering drawings' },
    { code: 'S2', kind: KsbKind.SKILL, title: 'Fault diagnosis' },
    { code: 'B1', kind: KsbKind.BEHAVIOUR, title: 'Works safely at all times' },
    { code: 'B2', kind: KsbKind.BEHAVIOUR, title: 'Takes responsibility' },
  ];
  let sortOrder = 0;
  for (const ksb of ksbs) {
    summary.ksbDefinitions += 1;
    await m.save(
      m.create(KsbDefinition, {
        organisationId: org.id,
        standardId: standard.id,
        code: ksb.code,
        kind: ksb.kind,
        title: ksb.title,
        sortOrder: sortOrder++,
      }),
    );
  }

  return standard;
}

const isoDate = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);

const at = (daysFromNow: number): Date =>
  new Date(Date.now() + daysFromNow * 86_400_000);

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const host = resolveHost();
  assertAllowed(host);

  const ds = await AppDataSource.initialize();
  console.log(`connected to host "${host}"`);

  await ds.transaction(async (m) => {
    const provider = await upsertOrganisation(m, PROVIDER);
    const employer = await upsertOrganisation(m, EMPLOYER);

    const providerOwner = await upsertUser(m, PROVIDER.contact);
    const employerOwner = await upsertUser(m, EMPLOYER.contact);
    const learnerUser = await upsertUser(m, {
      firstName: LEARNER.firstName,
      lastName: LEARNER.lastName,
      email: LEARNER.email,
      password: LEARNER.password,
      jobTitle: 'Apprentice engineering technician',
    });

    await upsertMembership(m, providerOwner, provider, OrganisationRole.OWNER);
    await upsertMembership(m, employerOwner, employer, OrganisationRole.OWNER);
    // The learner holds a plain membership of the *provider* organisation and
    // is identified as the apprentice by `enrolments.apprenticeUserId`, which
    // is the only column in the schema that says so (F1.2.5).
    await upsertMembership(m, learnerUser, provider, OrganisationRole.MEMBER);

    const standard = await upsertStandard(m, provider);

    let apprentice = await m.findOne(Apprentice, {
      where: { organisationId: provider.id, email: LEARNER.email },
    });
    if (!apprentice) {
      summary.apprentices += 1;
      apprentice = await m.save(
        m.create(Apprentice, {
          organisationId: provider.id,
          firstName: LEARNER.firstName,
          lastName: LEARNER.lastName,
          email: LEARNER.email,
          jobTitle: 'Apprentice engineering technician',
          status: ApprenticeStatus.ACTIVE,
        }),
      );
    }

    let enrolment = await m.findOne(Enrolment, {
      where: {
        organisationId: provider.id,
        apprenticeId: apprentice.id,
        standardId: standard.id,
      },
    });
    if (!enrolment) {
      summary.enrolments += 1;
      enrolment = await m.save(
        m.create(Enrolment, {
          organisationId: provider.id,
          apprenticeId: apprentice.id,
          standardId: standard.id,
          status: EnrolmentStatus.COMPLETED,
          activatedAt: at(-700),
          completedAt: at(-20),
          plannedStartDate: isoDate(-700),
          plannedEndDate: isoDate(-20),
          plannedDurationMonths: LEARNER.durationMonths,
          agreedPrice: String(LEARNER.fundingBandMax),
          apprenticeUserId: learnerUser.id,
          tutorUserId: providerOwner.id,
          employerManagerUserId: employerOwner.id,
          employerOrganisationId: employer.id,
          providerOrganisationId: provider.id,
          epaDate: isoDate(-30),
        }),
      );
    }

    // ── A held review, with its record and all three signatures ────────────
    let review = await m.findOne(Review, {
      where: { organisationId: provider.id, enrolmentId: enrolment.id },
    });
    if (!review) {
      summary.reviews += 1;
      review = await m.save(
        m.create(Review, {
          organisationId: provider.id,
          enrolmentId: enrolment.id,
          apprenticeId: apprentice.id,
          scheduledAt: at(-90),
          title: 'Twelve-weekly review (demo)',
          reviewType: '12_weekly',
          status: ReviewStatus.COMPLETED,
          isOverdue: false,
          apprenticeUserId: learnerUser.id,
          tutorUserId: providerOwner.id,
          employerManagerUserId: employerOwner.id,
        }),
      );
    }

    const existingRecord = await m.findOne(ReviewRecord, {
      where: { organisationId: provider.id, reviewId: review.id },
    });
    if (!existingRecord) {
      summary.reviewRecords += 1;
      await m.save(
        m.create(ReviewRecord, {
          organisationId: provider.id,
          reviewId: review.id,
          payload: {
            progressSummary:
              'On track. Fault diagnosis is now consistent without supervision.',
            otjDiscussed: true,
            safeguardingDiscussed: true,
            actionsAgreed: [
              'Complete the hydraulics module before the next review',
              'Employer to give two weeks on the night shift for wider exposure',
            ],
          },
          submittedAt: at(-89),
          submittedByUserId: providerOwner.id,
        }),
      );
    }

    const signatories: [ReviewSignerParty, number, string][] = [
      [ReviewSignerParty.APPRENTICE, 1, learnerUser.id],
      [ReviewSignerParty.TUTOR, 2, providerOwner.id],
      [ReviewSignerParty.EMPLOYER_MANAGER, 3, employerOwner.id],
    ];
    for (const [party, signOrder, signerUserId] of signatories) {
      const existing = await m.findOne(ReviewSignature, {
        where: { organisationId: provider.id, reviewId: review.id, party },
      });
      if (existing) continue;
      summary.reviewSignatures += 1;
      await m.save(
        m.create(ReviewSignature, {
          organisationId: provider.id,
          reviewId: review.id,
          party,
          signOrder,
          signerUserId,
          status: ReviewSignatureStatus.SIGNED,
        }),
      );
    }

    // ── A break in learning, closed, with both actors recorded ─────────────
    const existingBreak = await m.findOne(BreakInLearning, {
      where: { organisationId: provider.id, enrolmentId: enrolment.id },
    });
    if (!existingBreak) {
      summary.breaksInLearning += 1;
      await m.save(
        m.create(BreakInLearning, {
          organisationId: provider.id,
          enrolmentId: enrolment.id,
          apprenticeId: apprentice.id,
          // Deliberately unremarkable: `reason` frequently holds health or
          // caring detail on a real record, which is Article 9 data, and demo
          // content should not model that.
          reason: 'Planned unpaid leave agreed with the employer.',
          startedOn: isoDate(-200),
          expectedReturnDate: isoDate(-150),
          actualReturnDate: isoDate(-148),
          recordedByUserId: providerOwner.id,
          endedByUserId: providerOwner.id,
        }),
      );
    }

    // ── The assessment result ──────────────────────────────────────────────
    const existingOutcome = await m.findOne(EpaOutcomeRecord, {
      where: { organisationId: provider.id, enrolmentId: enrolment.id },
    });
    if (!existingOutcome) {
      summary.epaOutcomes += 1;
      await m.save(
        m.create(EpaOutcomeRecord, {
          organisationId: provider.id,
          enrolmentId: enrolment.id,
          outcome: EpaOutcome.MERIT,
          assessedOn: isoDate(-25),
          recordedByUserId: providerOwner.id,
        }),
      );
    }

    // ── KSB coverage, in every assessment state ────────────────────────────
    const definitions = await m.find(KsbDefinition, {
      where: { organisationId: provider.id, standardId: standard.id },
      order: { sortOrder: 'ASC' },
    });
    const assessments = [
      KsbCoverageAssessment.SUFFICIENT,
      KsbCoverageAssessment.SUFFICIENT,
      KsbCoverageAssessment.NEEDS_MORE,
    ];
    for (const [index, definition] of definitions.entries()) {
      const existing = await m.findOne(EnrolmentKsbCoverage, {
        where: {
          organisationId: provider.id,
          enrolmentId: enrolment.id,
          ksbDefinitionId: definition.id,
        },
      });
      if (existing) continue;
      summary.ksbCoverage += 1;
      await m.save(
        m.create(EnrolmentKsbCoverage, {
          organisationId: provider.id,
          enrolmentId: enrolment.id,
          ksbDefinitionId: definition.id,
          assessment: assessments[index % assessments.length],
          assessedByUserId: providerOwner.id,
          assessedAt: at(-60),
        }),
      );
    }
  });

  await ds.destroy();

  console.log('\nDemo content seed complete (additive — nothing was deleted):');
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key.padEnd(18)} ${value} created`);
  }
  console.log('\nLogins:');
  console.log(
    `  provider   ${PROVIDER.contact.email}  /  ${PROVIDER.contact.password}`,
  );
  console.log(
    `  employer   ${EMPLOYER.contact.email}  /  ${EMPLOYER.contact.password}`,
  );
  console.log(`  apprentice ${LEARNER.email}  /  ${LEARNER.password}`);
  console.log(
    '\nRe-running makes no further changes — every write is an upsert, and ' +
      'nothing outside the gradlly-demo-* organisations is read or written.',
  );
}

main().catch((error: unknown) => {
  console.error('DEMO CONTENT SEED FAILED:', error);
  process.exit(1);
});
