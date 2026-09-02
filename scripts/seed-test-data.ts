/**
 * Test seed data — all portals.
 *
 * Source: "Gradlly — Test Seed Data Reference, Version 1.0, August 2026".
 *
 * ── TWO THINGS THE SOURCE DOCUMENT GETS WRONG ABOUT THIS CODEBASE ────────────
 *
 * 1. It specifies "Prisma · tRPC" and a seed file at `prisma/seed.ts`. This
 *    project is NestJS + TypeORM and has never had Prisma. The *data* carries
 *    over unchanged; the mechanism does not, which is why this is a TypeORM
 *    script driven by the same `data-source.ts` the migrations use.
 *
 * 2. Its "Portal 4" is Gradlly Forge, an internal ops console. Portal 4 in the
 *    PRD and in this codebase is FlowPortal (levy exchange). There are no
 *    entities for platform-ops stats, system alerts or an onboarding queue, so
 *    that section is not seeded. Flagged rather than approximated — inventing a
 *    shape for it would be guessing at a feature nobody has specified.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 * This script wipes and rebuilds every table it owns. Against production it
 * would destroy every real account, so it refuses to run unless
 * `SEED_ALLOW=yes`, the database **host** is local, and the database **name**
 * is one of the known dev names. See the guards in `main()` for why `NODE_ENV`
 * is not trusted here.
 *
 * ── WHAT IT SEEDS ───────────────────────────────────────────────────────────
 *
 * Core:
 *   organisations, organisation_memberships, users, standards, programmes,
 *   ksb_definitions, apprentices, enrolments, enrolment_ksb_coverage,
 *   reviews, otj_log_entries
 *
 * Phase 1 demo data — enough to show every Must Have with no ESFA connection:
 *   das_levy_balances          F1.1.1  entered manually, never synced
 *   das_levy_monthly_entries   F1.1.3  twelve months for the chart
 *   das_donor_links            F4.1.1  status `manual`; tranches hang off it
 *   das_levy_tranches          F1.1.2  one expiring in 21 days, one in 61,
 *                                      so the red and amber banners both fire
 *   das_funding_payments       F1.1.5  six per employer, including a clawback
 *   commitment_statements      F1.3.1  every board column, plus one awaiting
 *   commitment_signatures      F1.3.2  each party's signature in turn
 *   ks_evidence_items          F3.3.1  all four statuses
 *   ks_evidence_ksb_mappings   F3.3.2  accepted counts of 0, 1 and 2+ so every
 *                                      heatmap cell state is reachable
 *   message_threads, messages  F3.4.2  tutor and line-manager threads, some
 *   message_thread_reads               left unread
 *   notifications              F3.4.3  one of every type, half unread
 *   eif_score_snapshots        F2.1.1  12 months; first provider below 75% so
 *                                      the sub-threshold banner is reachable
 *   qip_actions                F2.1.2  including one overdue
 *
 * Nothing here is fetched from the ESFA. The levy figures are seed data marked
 * `lastSyncStatus = manual`, which is what the sync card renders as "Manually
 * entered" rather than claiming a sync that never happened.
 *
 * Build first — `tsx` cannot run it, because TypeORM entities need decorator
 * metadata that only `tsc` emits:
 *
 *   npx nest build && SEED_ALLOW=yes node dist/scripts/seed-test-data.js
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';

import { Apprentice } from '../src/apprentices/entities/apprentice.entity.js';
import { ApprenticeStatus } from '../src/apprentices/enums/apprentice-status.enum.js';
import { CommitmentSignature } from '../src/commitments/entities/commitment-signature.entity.js';
import { CommitmentStatementGroup } from '../src/commitments/entities/commitment-statement-group.entity.js';
import { CommitmentStatement } from '../src/commitments/entities/commitment-statement.entity.js';
import { CommitmentSignatureStatus } from '../src/commitments/enums/commitment-signature-status.enum.js';
import { CommitmentStatementStatus } from '../src/commitments/enums/commitment-statement-status.enum.js';
import AppDataSource from '../src/config/data-source.js';
import { DasFundingPayment } from '../src/das/entities/das-funding-payment.entity.js';
import { DasLevyBalance } from '../src/das/entities/das-levy-balance.entity.js';
import { DasLevyMonthlyEntry } from '../src/das/entities/das-levy-monthly-entry.entity.js';
import { DasSyncStatus } from '../src/das/enums/das-sync-status.enum.js';
import { Enrolment } from '../src/enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../src/enrolments/enums/enrolment-status.enum.js';
import { DasDonorLink } from '../src/levy-exchange/entities/das-donor-link.entity.js';
import { DasLevyTranche } from '../src/levy-exchange/entities/das-levy-tranche.entity.js';
import { DasDonorLinkStatus } from '../src/levy-exchange/enums/das-donor-link-status.enum.js';
import { MessageThreadRead } from '../src/messaging/entities/message-thread-read.entity.js';
import { MessageThread } from '../src/messaging/entities/message-thread.entity.js';
import { Message } from '../src/messaging/entities/message.entity.js';
import { MessageThreadParty } from '../src/messaging/enums/message-thread-party.enum.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import { NotificationType } from '../src/notifications/enums/notification-type.enum.js';
import { EifScoreSnapshot } from '../src/ofsted/entities/eif-score-snapshot.entity.js';
import { QipAction } from '../src/ofsted/entities/qip-action.entity.js';
import { EifRag } from '../src/ofsted/enums/eif-rag.enum.js';
import { QipActionStatus } from '../src/ofsted/enums/qip-action-status.enum.js';
import { OrganisationMembership } from '../src/organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../src/organisations/entities/organisation.entity.js';
import { OrganisationRole } from '../src/organisations/organisation-role.enum.js';
import { PortalType } from '../src/organisations/portal-type.enum.js';
import { OtjLogEntry } from '../src/otj/entities/otj-log-entry.entity.js';
import { OtjActivityCategory } from '../src/otj/enums/otj-activity-category.enum.js';
import { OtjLogStatus } from '../src/otj/enums/otj-log-status.enum.js';
import { KsEvidenceItem } from '../src/portfolio/entities/ks-evidence-item.entity.js';
import { KsEvidenceKsbMapping } from '../src/portfolio/entities/ks-evidence-ksb-mapping.entity.js';
import { KsbDefinition } from '../src/portfolio/entities/ksb-definition.entity.js';
import { KsEvidenceStatus } from '../src/portfolio/enums/ks-evidence-status.enum.js';
import { KsEvidenceType } from '../src/portfolio/enums/ks-evidence-type.enum.js';
import { KsbKind } from '../src/portfolio/enums/ksb-kind.enum.js';
import { Programme } from '../src/programmes/entities/programme.entity.js';
import { Standard } from '../src/programmes/entities/standard.entity.js';
import { Review } from '../src/reviews/entities/review.entity.js';
import { ReviewStatus } from '../src/reviews/enums/review-status.enum.js';
import { TripartiteParty } from '../src/signing/tripartite-party.enum.js';
import { User } from '../src/users/entities/user.entity.js';

import type { EntityManager } from 'typeorm';

// ─── Reference data (appendix, page 20) ──────────────────────────────────────

const STANDARDS = [
  {
    code: 'ST0145',
    title: 'Engineering Technician',
    level: 3,
    months: 36,
    funding: 21000,
    otjHours: 525,
  },
  {
    code: 'ST0459',
    title: 'Maintenance & Operations Engineering Technician',
    level: 3,
    months: 42,
    funding: 27000,
    otjHours: 630,
  },
  {
    code: 'ST0016',
    title: 'Data Analyst',
    level: 4,
    months: 27,
    funding: 15000,
    otjHours: 405,
  },
  {
    code: 'ST0415',
    title: 'Software Developer',
    level: 4,
    months: 24,
    funding: 27000,
    otjHours: 360,
  },
  {
    code: 'ST0023',
    title: 'Financial Services Professional',
    level: 4,
    months: 30,
    funding: 10000,
    otjHours: 450,
  },
  {
    code: 'ST0162',
    title: 'Insurance Practitioner',
    level: 3,
    months: 24,
    funding: 5000,
    otjHours: 360,
  },
  {
    code: 'ST0005',
    title: 'Adult Care Worker',
    level: 2,
    months: 15,
    funding: 3000,
    otjHours: 225,
  },
  {
    code: 'ST0215',
    title: 'Senior Healthcare Support Worker',
    level: 3,
    months: 18,
    funding: 4000,
    otjHours: 270,
  },
  {
    code: 'ST0184',
    title: 'HR Support',
    level: 3,
    months: 18,
    funding: 5000,
    otjHours: 270,
  },
  {
    code: 'ST0456',
    title: 'Network Engineer',
    level: 4,
    months: 24,
    funding: 21000,
    otjHours: 360,
  },
];

const EMPLOYERS = [
  {
    slug: 'meridian-engineering',
    name: 'Meridian Engineering Solutions Ltd',
    city: 'Leeds',
    postcode: 'LS12 6AE',
    address: 'Unit 14 Whitehall Industrial Estate',
    contact: {
      first: 'Rachel',
      last: 'Thornton',
      email: 'r.thornton@meridian-eng.co.uk',
      password: 'MeridianTest2026!',
      jobTitle: 'Head of Learning & Development',
    },
  },
  {
    slug: 'nexvault-financial',
    name: 'Nexvault Financial Services PLC',
    city: 'London',
    postcode: 'EC2R 6AY',
    address: '25 Moorgate',
    contact: {
      first: 'James',
      last: 'Okafor',
      email: 'j.okafor@nexvault.co.uk',
      password: 'NexvaultTest2026!',
      jobTitle: 'Talent Acquisition & Early Careers Manager',
    },
  },
  {
    slug: 'brightfield-care',
    name: 'Brightfield Care Group',
    city: 'Birmingham',
    postcode: 'B3 2AB',
    address: '68 Colmore Row',
    contact: {
      first: 'Diane',
      last: 'Patel',
      email: 'diane.patel@brightfieldcare.co.uk',
      password: 'BrightfieldTest2026!',
      jobTitle: 'HR Director',
    },
  },
  {
    slug: 'veridia-construction',
    name: 'Veridia Construction Group Ltd',
    city: 'Crawley',
    postcode: 'RH10 6AD',
    address: 'Tower Point, Brighton Road',
    contact: {
      first: 'Kevin',
      last: 'Walsh',
      email: 'k.walsh@veridia-construction.co.uk',
      password: 'VeridiaTest2026!',
      jobTitle: 'Operations Director',
    },
  },
  {
    slug: 'solent-digital',
    name: 'Solent Digital Agency Ltd',
    city: 'Southampton',
    postcode: 'SO15 1GA',
    address: 'Ocean House, 2 Commercial Road',
    contact: {
      first: 'Aisha',
      last: 'Mensah',
      email: 'ceo@solentdigital.co.uk',
      password: 'SolentTest2026!',
      jobTitle: 'CEO',
    },
  },
];

const PROVIDERS = [
  {
    slug: 'aldgate-skills',
    name: 'Aldgate Skills Academy',
    ukprn: '10047281',
    city: 'London',
    postcode: 'E1 8EN',
    contact: {
      first: 'Marcus',
      last: 'Leigh',
      email: 'm.leigh@aldgateskills.ac.uk',
      password: 'AldgateTest2026!',
      jobTitle: 'Head of Apprenticeships',
    },
  },
  {
    slug: 'northern-futures',
    name: 'Northern Futures Training Ltd',
    ukprn: '10063447',
    city: 'Leeds',
    postcode: 'LS1 5AA',
    contact: {
      first: 'Sarah',
      last: 'Hutchinson',
      email: 's.hutchinson@northernfutures.co.uk',
      password: 'NorthernTest2026!',
      jobTitle: 'Director of Delivery',
    },
  },
  {
    slug: 'castlegate-institute',
    name: 'Castlegate Institute of Professional Learning',
    ukprn: '10089312',
    city: 'Manchester',
    postcode: 'M3 4LQ',
    contact: {
      first: 'Priya',
      last: 'Anand',
      email: 'p.anand@castlegate.ac.uk',
      password: 'CastlegateTest2026!',
      jobTitle: 'Apprenticeship Standards Lead',
    },
  },
  {
    slug: 'greenway-college',
    name: 'Greenway College of Further Education',
    ukprn: '10055123',
    city: 'Nottingham',
    postcode: 'NG1 5AA',
    contact: {
      first: 'Trevor',
      last: 'Bassett',
      email: 'admin@greenwaycollege.ac.uk',
      password: 'GreenwayTest2026!',
      jobTitle: 'Principal',
    },
  },
];

/**
 * The 15 apprentices, pages 9–17.
 *
 * `otjHours` / `targetHours` are transcribed from the document. The seeder does
 * **not** trust `progress` — it generates OTJ entries totalling `otjHours` and
 * lets the API compute the percentage, so the screens show a figure derived the
 * same way production would derive it. A seeded percentage would be exactly the
 * fabricated-number problem this build has spent a week removing.
 */
const APPRENTICES = [
  {
    first: 'Tyler',
    last: 'Bowen',
    email: 'tyler.bowen@meridian-eng.co.uk',
    password: 'TylerTest2026!',
    employer: 'meridian-engineering',
    provider: 'northern-futures',
    standard: 'ST0145',
    start: '2024-09-02',
    end: '2027-09-01',
    otjHours: 312,
    targetHours: 525,
    status: 'active',
    gateway: false,
  },
  {
    first: 'Joel',
    last: 'Nkemdirim',
    email: 'j.nkemdirim@meridian-eng.co.uk',
    password: 'JoelTest2026!',
    employer: 'meridian-engineering',
    provider: 'northern-futures',
    standard: 'ST0459',
    start: '2025-01-06',
    end: '2028-07-05',
    otjHours: 89,
    targetHours: 630,
    status: 'active',
    gateway: false,
    note: 'OTJ pace risk',
  },
  {
    first: 'Caitlin',
    last: 'Forsythe',
    email: 'c.forsythe@meridian-eng.co.uk',
    password: 'CaitlinTest2026!',
    employer: 'meridian-engineering',
    provider: 'northern-futures',
    standard: 'ST0145',
    start: '2023-09-04',
    end: '2026-09-03',
    otjHours: 524,
    targetHours: 525,
    status: 'active',
    gateway: true,
    epaDate: '2026-10-15',
  },
  {
    first: 'Marcus',
    last: 'Osei',
    email: 'm.osei@meridian-eng.co.uk',
    password: 'MarcusTest2026!',
    employer: 'meridian-engineering',
    provider: 'aldgate-skills',
    standard: 'ST0459',
    start: '2022-09-05',
    end: '2026-03-04',
    otjHours: 630,
    targetHours: 630,
    status: 'completed',
    gateway: true,
    completedAt: '2026-03-12',
    epaDate: '2026-02-20',
  },
  {
    first: 'Amara',
    last: 'Diallo',
    email: 'a.diallo@nexvault.co.uk',
    password: 'AmaraTest2026!',
    employer: 'nexvault-financial',
    provider: 'aldgate-skills',
    standard: 'ST0016',
    start: '2024-01-08',
    end: '2026-04-07',
    otjHours: 401,
    targetHours: 405,
    status: 'active',
    gateway: true,
    epaDate: '2026-09-30',
  },
  {
    first: 'Lucas',
    last: 'Ferreira',
    email: 'l.ferreira@nexvault.co.uk',
    password: 'LucasTest2026!',
    employer: 'nexvault-financial',
    provider: 'castlegate-institute',
    standard: 'ST0415',
    start: '2024-09-16',
    end: '2026-09-15',
    otjHours: 198,
    targetHours: 360,
    status: 'active',
    gateway: false,
    epaDate: '2026-11-02',
  },
  {
    first: 'Zara',
    last: 'Yilmaz',
    email: 'z.yilmaz@nexvault.co.uk',
    password: 'ZaraTest2026!',
    employer: 'nexvault-financial',
    provider: 'castlegate-institute',
    standard: 'ST0023',
    start: '2024-03-11',
    end: '2026-09-10',
    otjHours: 287,
    targetHours: 450,
    status: 'active',
    gateway: false,
  },
  {
    first: 'Rhys',
    last: 'Cartwright',
    email: 'r.cartwright@nexvault.co.uk',
    password: 'RhysTest2026!',
    employer: 'nexvault-financial',
    provider: 'aldgate-skills',
    standard: 'ST0016',
    start: '2022-06-01',
    end: '2024-09-01',
    otjHours: 405,
    targetHours: 405,
    status: 'completed',
    gateway: true,
    completedAt: '2024-09-15',
  },
  {
    first: 'Fatima',
    last: 'Al-Hassan',
    email: 'f.alhassan@nexvault.co.uk',
    password: 'FatimaTest2026!',
    employer: 'nexvault-financial',
    provider: 'castlegate-institute',
    standard: 'ST0415',
    start: '2024-01-15',
    end: '2026-01-14',
    otjHours: 142,
    targetHours: 360,
    status: 'cancelled',
    gateway: false,
    cancelledAt: '2024-11-30',
  },
  {
    first: 'Priyanka',
    last: 'Sharma',
    email: 'p.sharma@brightfieldcare.co.uk',
    password: 'PriyankaTest2026!',
    employer: 'brightfield-care',
    provider: 'northern-futures',
    standard: 'ST0215',
    start: '2024-04-15',
    end: '2025-10-14',
    otjHours: 270,
    targetHours: 270,
    status: 'active',
    gateway: true,
    epaDate: '2026-09-02',
  },
  {
    first: 'Sophie',
    last: 'Maddocks',
    email: 's.maddocks@brightfieldcare.co.uk',
    password: 'SophieTest2026!',
    employer: 'brightfield-care',
    provider: 'northern-futures',
    standard: 'ST0005',
    start: '2024-07-01',
    end: '2025-10-01',
    otjHours: 225,
    targetHours: 225,
    status: 'completed',
    gateway: true,
    completedAt: '2025-10-05',
  },
  {
    first: 'Kofi',
    last: 'Asante',
    email: 'k.asante@brightfieldcare.co.uk',
    password: 'KofiTest2026!',
    employer: 'brightfield-care',
    provider: 'northern-futures',
    standard: 'ST0215',
    start: '2025-04-07',
    end: '2026-10-06',
    otjHours: 120,
    targetHours: 270,
    status: 'active',
    gateway: false,
  },
  {
    first: 'Niamh',
    last: "O'Sullivan",
    email: 'n.osullivan@brightfieldcare.co.uk',
    password: 'NiamhTest2026!',
    employer: 'brightfield-care',
    provider: 'greenway-college',
    standard: 'ST0005',
    start: '2024-09-02',
    end: '2025-12-01',
    otjHours: 67,
    targetHours: 225,
    status: 'active',
    gateway: false,
    note: 'Break in learning',
  },
  {
    first: 'Dan',
    last: 'Whitmore',
    email: 'd.whitmore@veridia-construction.co.uk',
    password: 'DanTest2026!',
    employer: 'veridia-construction',
    provider: 'northern-futures',
    standard: 'ST0145',
    start: '2025-02-03',
    end: '2028-02-02',
    otjHours: 134,
    targetHours: 525,
    status: 'active',
    gateway: false,
  },
  {
    first: 'Leila',
    last: 'Nouri',
    email: 'l.nouri@veridia-construction.co.uk',
    password: 'LeilaTest2026!',
    employer: 'veridia-construction',
    provider: 'northern-futures',
    standard: 'ST0184',
    start: '2025-06-09',
    end: '2026-12-08',
    otjHours: 77,
    targetHours: 270,
    status: 'active',
    gateway: false,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OTJ_CATEGORIES = Object.values(OtjActivityCategory);

const ACTIVITY_NAMES = [
  'Shadowing a senior colleague',
  'Technical training session',
  'Reading standard documentation',
  'Mentoring session with tutor',
  'Practical workshop',
  'Online module',
  'Team design review',
  'Site visit',
];

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Deterministic pseudo-random so reseeding produces the same database. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** A generic KSB set per standard: 12 knowledge, 10 skills, 6 behaviours. */
function ksbsFor(standardCode: string) {
  const out: {
    code: string;
    kind: KsbKind;
    title: string;
    sortOrder: number;
  }[] = [];
  const groups: [KsbKind, string, number][] = [
    [KsbKind.KNOWLEDGE, 'K', 12],
    [KsbKind.SKILL, 'S', 10],
    [KsbKind.BEHAVIOUR, 'B', 6],
  ];
  let order = 0;
  for (const [kind, prefix, count] of groups) {
    for (let i = 1; i <= count; i++) {
      out.push({
        code: `${prefix}${i}`,
        kind,
        title: `${standardCode} ${kind} ${i}`,
        sortOrder: order++,
      });
    }
  }
  return out;
}

// ─── Seed ────────────────────────────────────────────────────────────────────

async function main() {
  /**
   * ── GUARDS ────────────────────────────────────────────────────────────────
   *
   * This script issues `DELETE FROM users` and eight other tables. Running it
   * against production would destroy every real account.
   *
   * The first version of this guard checked that the database name matched
   * `/test|graddly/` — which a **production** database called `graddly` passes.
   * That is exactly backwards: the guard would have waved through the one case
   * it exists to stop. Replaced with checks that cannot be satisfied by a
   * remote environment by accident.
   */
  if (process.env.SEED_ALLOW !== 'yes') {
    throw new Error('Refusing to run without SEED_ALLOW=yes');
  }
  /**
   * `NODE_ENV` is **not** used as a gate, deliberately. This repository's local
   * `graddly-api/.env` sets `NODE_ENV="production"` on a developer machine, so
   * gating on it would block every legitimate local run while proving nothing
   * about where the database actually is. Warned about, not trusted.
   */
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: NODE_ENV=production. Proceeding only because the database ' +
        'host and name are local — check both below before continuing.',
    );
  }

  // The decisive check: a production database is not on this machine.
  const host = (process.env.DB_HOST ?? '').trim();
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'db', 'postgres'];
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to seed a non-local database host "${host}". ` +
        `Allowed: ${LOCAL_HOSTS.join(', ')}`,
    );
  }

  const dbName = (process.env.DB_NAME ?? '').trim();
  const ALLOWED_DBS = ['graddly', 'graddly_test', 'graddly_dev'];
  if (!ALLOWED_DBS.includes(dbName)) {
    throw new Error(
      `Refusing to seed database "${dbName}". Allowed: ${ALLOWED_DBS.join(', ')}`,
    );
  }

  const ds = await AppDataSource.initialize();
  console.log(`connected to ${dbName}`);

  const passwordHash = await bcrypt.hash('placeholder', 10);
  const hashCache = new Map<string, string>();
  const hash = async (plain: string) => {
    if (!hashCache.has(plain))
      hashCache.set(plain, await bcrypt.hash(plain, 10));
    return hashCache.get(plain)!;
  };
  void passwordHash;

  await ds.transaction(async (m: EntityManager) => {
    /**
     * `audit_log_entries` is append-only, enforced by a trigger — deliberately,
     * because an audit trail that can be rewritten is not an audit trail
     * (see `db:verify-audit-immutability`). Deleting users cascades into it, so
     * a second run of this seed fails where the first succeeded on empty tables.
     *
     * Triggers are suspended for the wipe only. This is safe *here* because the
     * guards above have already established the database is local and named as
     * a dev database — and it is the reason those guards are strict. The
     * setting is transaction-scoped, so it reverts on commit or rollback either
     * way.
     */
    await m.query(`SET LOCAL session_replication_role = replica`);

    // Wipe only what this script owns, children first.
    for (const table of [
      'audit_log_entries',
      // Added with the Phase 1 demo data. Foreign-key triggers are suspended
      // for this block, so order is not load-bearing — children are still
      // listed first so the list reads correctly if that ever changes.
      'message_thread_reads',
      'messages',
      'message_threads',
      'notifications',
      'ks_evidence_ksb_mappings',
      'ks_evidence_items',
      'commitment_signatures',
      'commitment_statement_groups',
      'commitment_statements',
      'qip_actions',
      'eif_score_snapshots',
      'das_levy_tranches',
      'das_donor_links',
      'das_levy_monthly_entries',
      'das_funding_payments',
      'das_levy_balances',
      'otj_log_entries',
      'reviews',
      'enrolment_ksb_coverage',
      'ksb_definitions',
      'enrolments',
      'apprentices',
      'standards',
      'programmes',
      'organisation_memberships',
      'organisations',
    ]) {
      await m.query(`DELETE FROM "${table}"`);
    }
    await m.query(`DELETE FROM "users"`);
    console.log('cleared existing rows');

    const orgBySlug = new Map<string, Organisation>();
    const userByEmail = new Map<string, User>();

    // Organisations + their primary contact user + membership.
    for (const spec of [
      ...EMPLOYERS.map((e) => ({
        ...e,
        portal: PortalType.EMPLOYER,
        ukprn: null as string | null,
      })),
      ...PROVIDERS.map((p) => ({
        ...p,
        portal: PortalType.PROVIDER,
        address: null as string | null,
      })),
    ]) {
      const org = await m.save(
        m.create(Organisation, {
          name: spec.name,
          slug: spec.slug,
          portalType: spec.portal,
          type:
            spec.portal === PortalType.EMPLOYER
              ? 'employer'
              : 'training_provider',
          ukprn: spec.ukprn ?? null,
          address: (spec as { address?: string | null }).address ?? null,
          city: spec.city,
          postcode: spec.postcode,
          country: 'United Kingdom',
        }),
      );
      orgBySlug.set(spec.slug, org);

      const user = await m.save(
        m.create(User, {
          firstName: spec.contact.first,
          lastName: spec.contact.last,
          email: spec.contact.email,
          password: await hash(spec.contact.password),
          isEmailVerified: true,
          isActive: true,
          jobTitle: spec.contact.jobTitle,
        }),
      );
      userByEmail.set(spec.contact.email, user);

      await m.save(
        m.create(OrganisationMembership, {
          user,
          organisation: org,
          role: OrganisationRole.OWNER,
        }),
      );
    }
    console.log(`organisations: ${orgBySlug.size}`);

    // One programme + standard set per provider, so every provider can enrol on
    // the standards it lists. Standards are org-scoped in this schema.
    const standardByOrgAndCode = new Map<string, Standard>();
    const ksbsByStandardId = new Map<string, KsbDefinition[]>();

    for (const provider of PROVIDERS) {
      const org = orgBySlug.get(provider.slug)!;
      const programme = await m.save(
        m.create(Programme, {
          organisationId: org.id,
          code: `PRG-${provider.slug.toUpperCase()}`,
          title: `${provider.name} apprenticeship programme`,
        }),
      );

      for (const s of STANDARDS) {
        const standard = await m.save(
          m.create(Standard, {
            organisationId: org.id,
            programmeId: programme.id,
            code: s.code,
            title: `${s.title} L${s.level}`,
            fundingBandMax: String(s.funding),
            defaultDurationMonths: s.months,
          }),
        );
        standardByOrgAndCode.set(`${provider.slug}:${s.code}`, standard);

        const defs = await m.save(
          ksbsFor(s.code).map((k) =>
            m.create(KsbDefinition, {
              organisationId: org.id,
              standardId: standard.id,
              code: k.code,
              kind: k.kind,
              title: k.title,
              sortOrder: k.sortOrder,
            }),
          ),
        );
        ksbsByStandardId.set(standard.id, defs);
      }
    }
    console.log(`standards: ${standardByOrgAndCode.size}, with KSBs`);

    // Apprentices, enrolments, OTJ history, reviews.
    let otjCount = 0;
    let reviewCount = 0;

    /**
     * Everything the later sections need per learner.
     *
     * Commitment statements, evidence, messages and notifications all hang off
     * an enrolment and its three parties, and all of them are seeded after this
     * loop rather than inside it — keeping each concern in one readable block
     * instead of a single loop that does nine things.
     */
    const learners: {
      spec: (typeof APPRENTICES)[number];
      user: User;
      apprentice: Apprentice;
      enrolment: Enrolment;
      providerOrg: Organisation;
      employerOrg: Organisation;
      standard: Standard;
      tutorUser: User;
      managerUser: User;
      startDate: Date;
    }[] = [];

    for (const [index, a] of APPRENTICES.entries()) {
      const providerOrg = orgBySlug.get(a.provider)!;
      const employerOrg = orgBySlug.get(a.employer)!;
      const standard = standardByOrgAndCode.get(`${a.provider}:${a.standard}`)!;
      const rand = makeRandom(index + 1);

      const user = await m.save(
        m.create(User, {
          firstName: a.first,
          lastName: a.last,
          email: a.email,
          password: await hash(a.password),
          isEmailVerified: true,
          isActive: true,
          jobTitle: 'Apprentice',
        }),
      );
      userByEmail.set(a.email, user);

      /**
       * The apprentice is a MEMBER of the *provider* organisation — not of a
       * separate apprentice org. This mirrors what the frontend expects
       * (`useAuthUser` filters to portalType "provider" for the apprentice
       * portal) and is the same membership shape that made learner-scope
       * necessary in the first place: apprentice and tutor hold the same role.
       */
      await m.save(
        m.create(OrganisationMembership, {
          user,
          organisation: providerOrg,
          role: OrganisationRole.MEMBER,
        }),
      );

      const apprentice = await m.save(
        m.create(Apprentice, {
          organisationId: providerOrg.id,
          firstName: a.first,
          lastName: a.last,
          email: a.email,
          jobTitle: 'Apprentice',
          status:
            a.status === 'cancelled'
              ? ApprenticeStatus.WITHDRAWN
              : a.status === 'completed'
                ? ApprenticeStatus.COMPLETED
                : ApprenticeStatus.ACTIVE,
        }),
      );

      const startDate = new Date(`${a.start}T00:00:00.000Z`);
      const months = STANDARDS.find((s) => s.code === a.standard)!.months;

      const enrolment = await m.save(
        m.create(Enrolment, {
          organisationId: providerOrg.id,
          apprenticeId: apprentice.id,
          standardId: standard.id,
          status:
            a.status === 'completed'
              ? EnrolmentStatus.COMPLETED
              : a.status === 'cancelled'
                ? EnrolmentStatus.CANCELLED
                : EnrolmentStatus.ACTIVE,
          activatedAt: startDate,
          completedAt: a.completedAt
            ? new Date(`${a.completedAt}T00:00:00.000Z`)
            : null,
          cancelledAt: a.cancelledAt
            ? new Date(`${a.cancelledAt}T00:00:00.000Z`)
            : null,
          plannedStartDate: a.start,
          plannedEndDate: a.end,
          plannedDurationMonths: months,
          apprenticeUserId: user.id,
          employerOrganisationId: employerOrg.id,
          providerOrganisationId: providerOrg.id,
          epaDate: a.epaDate ?? null,
        }),
      );

      /**
       * OTJ entries totalling the documented hours. Most are approved (they are
       * what the documented figure counts); a few recent ones are left
       * submitted or draft so the portal has something in every status — the
       * approved/pending distinction is the whole point of client decision D2
       * and needs real rows on both sides to be visible.
       */
      const totalMinutes = a.otjHours * 60;
      const sessions = Math.max(6, Math.round(a.otjHours / 6));
      const perSession = Math.floor(totalMinutes / sessions);
      const spanDays = Math.max(
        30,
        Math.round((Date.now() - startDate.getTime()) / 86_400_000),
      );

      const entries: OtjLogEntry[] = [];
      for (let i = 0; i < sessions; i++) {
        const when = addDays(startDate, Math.floor((spanDays / sessions) * i));
        if (when.getTime() > Date.now()) break;

        // Last two sessions stay unapproved so pending is non-zero.
        const isRecent = i >= sessions - 2;
        const status =
          a.status === 'active' && isRecent
            ? i === sessions - 1
              ? OtjLogStatus.DRAFT
              : OtjLogStatus.SUBMITTED
            : OtjLogStatus.APPROVED;

        entries.push(
          m.create(OtjLogEntry, {
            organisationId: providerOrg.id,
            enrolmentId: enrolment.id,
            apprenticeId: apprentice.id,
            loggedDate: iso(when),
            minutes: perSession,
            activityName:
              ACTIVITY_NAMES[Math.floor(rand() * ACTIVITY_NAMES.length)],
            category:
              OTJ_CATEGORIES[Math.floor(rand() * OTJ_CATEGORIES.length)],
            status,
            submittedAt: status === OtjLogStatus.DRAFT ? null : when,
            approvedAt: status === OtjLogStatus.APPROVED ? when : null,
          }),
        );
      }
      await m.save(entries);
      otjCount += entries.length;

      /**
       * 12-weekly reviews across the elapsed programme. The most recent one on
       * an active enrolment is left scheduled and in the past for two learners,
       * so the timeline has a genuine `overdue` milestone to render (client
       * decision Q2) rather than only the happy path.
       */
      const reviews: Review[] = [];
      const weeksElapsed = Math.floor(spanDays / 7);
      const reviewCountForLearner = Math.max(1, Math.floor(weeksElapsed / 12));
      for (let i = 0; i < reviewCountForLearner; i++) {
        const when = addDays(startDate, (i + 1) * 84);
        if (when.getTime() > Date.now() + 86_400_000 * 90) break;

        const isFuture = when.getTime() > Date.now();
        const leaveOverdue =
          a.note === 'OTJ pace risk' && i === reviewCountForLearner - 1;

        reviews.push(
          m.create(Review, {
            organisationId: providerOrg.id,
            enrolmentId: enrolment.id,
            apprenticeId: apprentice.id,
            scheduledAt: when,
            title: `12-weekly review ${i + 1}`,
            reviewType: 'progress',
            status:
              isFuture || leaveOverdue
                ? ReviewStatus.SCHEDULED
                : ReviewStatus.COMPLETED,
            apprenticeUserId: user.id,
            tutorUserId: userByEmail.get(
              PROVIDERS.find((p) => p.slug === a.provider)!.contact.email,
            )!.id,
            // NOT NULL on this table — a review is tripartite by design, so it
            // cannot exist without the employer side named.
            employerManagerUserId: userByEmail.get(
              EMPLOYERS.find((e) => e.slug === a.employer)!.contact.email,
            )!.id,
          }),
        );
      }
      await m.save(reviews);
      reviewCount += reviews.length;

      learners.push({
        spec: a,
        user,
        apprentice,
        enrolment,
        providerOrg,
        employerOrg,
        standard,
        tutorUser: userByEmail.get(
          PROVIDERS.find((pr) => pr.slug === a.provider)!.contact.email,
        )!,
        managerUser: userByEmail.get(
          EMPLOYERS.find((e) => e.slug === a.employer)!.contact.email,
        )!,
        startDate,
      });
    }

    /**
     * ── DAS LEVY DATA (F1.1.1, F1.1.2, F1.1.3, F1.1.5) ──────────────────────
     *
     * Seeded as **manually entered**, not synced. There is no ESFA connection
     * on a developer machine, and `lastSyncStatus = MANUAL` is what the sync
     * card renders as "Manually entered" rather than a green "Synced" over
     * figures this script invented.
     *
     * The tranche expiry dates are the point of this block. F1.1.2 has two
     * banners — amber inside 90 days, red inside 30 — and neither is reachable
     * without a tranche actually falling in each window, so the offsets below
     * are chosen rather than random.
     */
    const now = new Date();
    let levyBalanceCount = 0;
    let trancheCount = 0;
    let paymentCount = 0;

    for (const [employerIndex, employerSpec] of EMPLOYERS.entries()) {
      const employerOrg = orgBySlug.get(employerSpec.slug)!;
      const rand = makeRandom(500 + employerIndex);

      // A round-ish figure per employer, deterministic but not identical.
      const balance = 40_000 + Math.floor(rand() * 60_000);

      await m.save(
        m.create(DasLevyBalance, {
          organisationId: employerOrg.id,
          ukprn: null,
          accountId: `MANUAL-ACC-${employerIndex + 1}`,
          balance: balance.toFixed(2),
          currency: 'GBP',
          lastSyncStatus: DasSyncStatus.MANUAL,
          lastErrorMessage: null,
          lastSyncedAt: now,
          rawPayload: { source: 'seed', enteredBy: 'seed-test-data' },
          utilisationSegments: null,
        }),
      );
      levyBalanceCount += 1;

      // F1.1.3 — twelve months of contributions and spend for the chart.
      const monthly: DasLevyMonthlyEntry[] = [];
      for (let i = 11; i >= 0; i--) {
        const month = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
        );
        const contributions = 3_000 + Math.floor(rand() * 2_000);
        monthly.push(
          m.create(DasLevyMonthlyEntry, {
            organisationId: employerOrg.id,
            month: iso(month).slice(0, 7) + '-01',
            contributions: contributions.toFixed(2),
            spend: Math.floor(contributions * (0.4 + rand() * 0.5)).toFixed(2),
            currency: 'GBP',
          }),
        );
      }
      await m.save(monthly);

      /**
       * A donor link per employer, recorded as MANUAL rather than LINKED: no
       * OAuth consent ever happened, and nothing should treat this as a live
       * connection it can sync against. Tranches require one — `das_levy_tranches`
       * is keyed on `donorLinkId` — so this row exists to hang them from as
       * much as to demonstrate F4.1.1.
       */
      const donorLink = await m.save(
        m.create(DasDonorLink, {
          organisationId: employerOrg.id,
          label: `${employerSpec.name} levy account`,
          dasAccountId: `MANUAL-ACC-${employerIndex + 1}`,
          ukprn: null,
          status: DasDonorLinkStatus.MANUAL,
          lastErrorMessage: null,
          consentedAt: null,
          lastSyncedAt: now,
          lastBalance: balance.toFixed(2),
          lastRawPayload: { source: 'seed' },
        }),
      );

      /**
       * Expiry offsets chosen so both F1.1.2 banners have something to fire on:
       *
       *   21 days  → inside the 30-day window, red
       *   61 days  → inside the 90-day window, amber
       *   240 days → outside both, so the "not at risk" case is represented too
       *
       * Funds expire 24 months after the month they were paid in, so a real
       * account holds several tranches at different distances. Three is enough
       * to render every state the banner can show.
       */
      const tranches: DasLevyTranche[] = [];
      for (const [offsetDays, amount] of [
        [21, 4_200],
        [61, 7_800],
        [240, 15_500],
      ] as const) {
        tranches.push(
          m.create(DasLevyTranche, {
            organisationId: employerOrg.id,
            donorLinkId: donorLink.id,
            amount: amount.toFixed(2),
            expiresOn: iso(addDays(now, offsetDays)),
            rawPayload: { source: 'seed' },
          }),
        );
      }
      await m.save(tranches);
      trancheCount += tranches.length;

      /**
       * Funding payments, including one clawback. A clawback is a negative
       * adjustment the ESFA makes when a learner withdraws early, and it reads
       * very differently from an ordinary payment — the reporting screens have
       * a branch for it that nothing would exercise without a row here.
       */
      const payments: DasFundingPayment[] = [];
      for (let i = 0; i < 6; i++) {
        const when = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 15),
        );
        const isClawback = i === 2;
        payments.push(
          m.create(DasFundingPayment, {
            organisationId: employerOrg.id,
            enrolmentId: null,
            paymentDate: iso(when),
            amount: isClawback
              ? (-1 * (600 + Math.floor(rand() * 400))).toFixed(2)
              : (900 + Math.floor(rand() * 700)).toFixed(2),
            currency: 'GBP',
            fundingPeriod: `${when.getUTCFullYear()}-${String(
              when.getUTCFullYear() + 1,
            ).slice(2)}`,
            clawbackNotice: isClawback
              ? 'Learner withdrew before the qualifying period; monthly payment recovered.'
              : null,
            externalReference: `MANUAL-PAY-${employerIndex + 1}-${i + 1}`,
            rawPayload: { source: 'seed' },
            lastSyncedAt: now,
          }),
        );
      }
      await m.save(payments);
      paymentCount += payments.length;
    }

    console.log(
      `levy: ${levyBalanceCount} balances, ${trancheCount} tranches, ${paymentCount} payments`,
    );

    /**
     * ── COMMITMENT STATEMENTS (F1.3.1, F1.3.2, F1.3.3, F3.4.1) ──────────────
     *
     * The F1.3.1 board groups statements by status, so every column needs a
     * row or the board demonstrates nothing. Signing order is
     * COMMITMENT_SIGNING_ORDER — tutor, then employer manager, then apprentice
     * — and the partially-signed rows stop at a different point each time so
     * that "awaiting X" exists for each of the three parties.
     */
    const COMMITMENT_PLAN: {
      status: CommitmentStatementStatus;
      signedUpTo: number; // how many parties in signing order have signed
      note: string;
    }[] = [
      { status: CommitmentStatementStatus.DRAFT, signedUpTo: 0, note: 'draft' },
      {
        status: CommitmentStatementStatus.SUBMITTED,
        signedUpTo: 0,
        note: 'submitted',
      },
      {
        status: CommitmentStatementStatus.AWAITING_SIGNATURES,
        signedUpTo: 0,
        note: 'awaiting tutor',
      },
      {
        status: CommitmentStatementStatus.AWAITING_SIGNATURES,
        signedUpTo: 1,
        note: 'awaiting employer',
      },
      {
        status: CommitmentStatementStatus.AWAITING_SIGNATURES,
        signedUpTo: 2,
        note: 'awaiting apprentice',
      },
      {
        status: CommitmentStatementStatus.SIGNED,
        signedUpTo: 3,
        note: 'fully signed',
      },
      {
        status: CommitmentStatementStatus.CANCELLED,
        signedUpTo: 1,
        note: 'cancelled',
      },
    ];

    let commitmentCount = 0;
    let signatureCount = 0;

    for (const [i, plan] of COMMITMENT_PLAN.entries()) {
      const learner = learners[i % learners.length];

      const group = await m.save(
        m.create(CommitmentStatementGroup, {
          organisationId: learner.providerOrg.id,
          enrolmentId: learner.enrolment.id,
          apprenticeId: learner.apprentice.id,
          currentVersionId: null,
        }),
      );

      const statement = await m.save(
        m.create(CommitmentStatement, {
          organisationId: learner.providerOrg.id,
          groupId: group.id,
          version: 1,
          status: plan.status,
          /**
           * Structured, not prose — the API stores this as JSON and each portal
           * renders it. The apprentice screen composes its plain-English
           * summary from these named fields (F3.4.1 AC1), so they carry real
           * sentences rather than lorem text.
           */
          content: {
            trainingPlanSummary: `${learner.spec.first} is training towards ${learner.standard.title} over ${STANDARDS.find((s) => s.code === learner.spec.standard)!.months} months.`,
            apprenticeCommitments:
              'Attend all scheduled training. Log off-the-job hours weekly. Bring evidence to each review.',
            employerCommitments:
              'Provide at least 6 hours a week for off-the-job training, a workplace mentor, and release for reviews.',
            providerCommitments:
              'Deliver the training plan, assess evidence within 10 working days, and hold a progress review every 12 weeks.',
            weeklyHours: 6,
            additionalTerms:
              'Travel to the training centre is reimbursed monthly.',
          },
          apprenticeUserId: learner.user.id,
          tutorUserId: learner.tutorUser.id,
          employerManagerUserId: learner.managerUser.id,
          snapshotPdfJobId: null,
          finalSignedPdfKey:
            plan.status === CommitmentStatementStatus.SIGNED
              ? `orgs/${learner.providerOrg.id}/commitments/seed-signed-${i + 1}.pdf`
              : null,
          publishedAt:
            plan.status === CommitmentStatementStatus.DRAFT
              ? null
              : addDays(learner.startDate, 7),
          publishedByUserId:
            plan.status === CommitmentStatementStatus.DRAFT
              ? null
              : learner.tutorUser.id,
          supersededAt: null,
        }),
      );

      group.currentVersionId = statement.id;
      await m.save(group);
      commitmentCount += 1;

      // Signing order: tutor -> employer manager -> apprentice.
      const parties: [TripartiteParty, string][] = [
        [TripartiteParty.TUTOR, learner.tutorUser.id],
        [TripartiteParty.EMPLOYER_MANAGER, learner.managerUser.id],
        [TripartiteParty.APPRENTICE, learner.user.id],
      ];

      const signatures = parties.map(([party, signerUserId], order) =>
        m.create(CommitmentSignature, {
          organisationId: learner.providerOrg.id,
          statementId: statement.id,
          party,
          signOrder: order + 1,
          signerUserId,
          status:
            order < plan.signedUpTo
              ? CommitmentSignatureStatus.SIGNED
              : CommitmentSignatureStatus.PENDING,
          signatureRecordId: null,
        }),
      );
      await m.save(signatures);
      signatureCount += signatures.length;
    }

    console.log(
      `commitments: ${commitmentCount} statements, ${signatureCount} signatures`,
    );

    /**
     * ── KSB EVIDENCE (F3.3.1, F3.3.2) ───────────────────────────────────────
     *
     * The heatmap counts **accepted** evidence per KSB and buckets it: 0 is
     * `none`, 1 is `low`, 2 or more is `adequate`
     * (`portfolio-heatmap.service.ts:160`, `HEATMAP_STRENGTH_ADEQUATE_MIN = 2`).
     * The cell colour then combines that strength with the tutor's coverage
     * assessment, which the existing `enrolment_ksb_coverage` seeding supplies.
     *
     * Rather than guess which combination produces which colour, this seeds
     * every combination: accepted counts of 0, 1 and 2+ across KSBs that are
     * assessed sufficient, needs-more and not assessed at all. Whatever the
     * five colours map to, all five are reachable.
     *
     * Items in draft, submitted and reviewed states are seeded too — they do
     * not count towards the heatmap, which is the point: they exercise the
     * evidence list and the tutor's review queue without moving a cell.
     */
    let evidenceCount = 0;
    let mappingCount = 0;

    for (const [learnerIndex, learner] of learners.entries()) {
      if (learner.spec.status === 'cancelled') continue;

      const ksbs = await m.find(KsbDefinition, {
        where: { standardId: learner.standard.id },
        order: { sortOrder: 'ASC' },
      });
      if (ksbs.length === 0) continue;

      const rand = makeRandom(900 + learnerIndex);
      const items: { item: KsEvidenceItem; ksbIndexes: number[] }[] = [];

      const push = (
        status: KsEvidenceStatus,
        title: string,
        ksbIndexes: number[],
      ) => {
        const when = addDays(learner.startDate, 30 + items.length * 11);
        const submitted = status !== KsEvidenceStatus.DRAFT;
        const reviewed =
          status === KsEvidenceStatus.REVIEWED ||
          status === KsEvidenceStatus.ACCEPTED;
        const accepted = status === KsEvidenceStatus.ACCEPTED;

        items.push({
          item: m.create(KsEvidenceItem, {
            organisationId: learner.providerOrg.id,
            enrolmentId: learner.enrolment.id,
            apprenticeId: learner.apprentice.id,
            type: KsEvidenceType.TEXT,
            title,
            body: `${title}. Written up by ${learner.spec.first} against the standard.`,
            storageKey: null,
            externalUrl: null,
            status,
            submittedAt: submitted ? when : null,
            submittedByUserId: submitted ? learner.user.id : null,
            reviewedAt: reviewed ? addDays(when, 3) : null,
            reviewedByUserId: reviewed ? learner.tutorUser.id : null,
            acceptedAt: accepted ? addDays(when, 4) : null,
            acceptedByUserId: accepted ? learner.tutorUser.id : null,
            returnedAt: null,
            returnedByUserId: null,
            returnReason: null,
          }),
          ksbIndexes,
        });
      };

      /**
       * KSB 0 gets two accepted items  -> strength `adequate`
       * KSB 1 gets one accepted item   -> strength `low`
       * KSB 2 gets none                -> strength `none`
       * and the three non-accepted statuses land on KSB 3, which therefore
       * stays `none` despite having evidence attached — the case that catches
       * a heatmap counting submissions instead of acceptances.
       */
      push(KsEvidenceStatus.ACCEPTED, 'Sprint retrospective write-up', [0]);
      push(KsEvidenceStatus.ACCEPTED, 'Incident postmortem contribution', [0]);
      push(KsEvidenceStatus.ACCEPTED, 'Automated test suite walkthrough', [1]);
      push(KsEvidenceStatus.REVIEWED, 'Code review notes', [3]);
      push(KsEvidenceStatus.SUBMITTED, 'Deployment runbook draft', [3]);
      push(KsEvidenceStatus.DRAFT, 'Notes towards a design document', [3]);

      // A couple more accepted items spread across the rest, so a real portfolio
      // is not four KSBs wide.
      for (let k = 4; k < Math.min(ksbs.length, 12); k += 2) {
        push(KsEvidenceStatus.ACCEPTED, `Evidence against ${ksbs[k].code}`, [
          k,
        ]);
        if (rand() > 0.5) {
          push(
            KsEvidenceStatus.ACCEPTED,
            `Second evidence against ${ksbs[k].code}`,
            [k],
          );
        }
      }

      const savedItems = await m.save(items.map((row) => row.item));
      evidenceCount += savedItems.length;

      const mappings: KsEvidenceKsbMapping[] = [];
      savedItems.forEach((saved, idx) => {
        for (const ksbIndex of items[idx].ksbIndexes) {
          const ksb = ksbs[ksbIndex];
          if (!ksb) continue;
          mappings.push(
            m.create(KsEvidenceKsbMapping, {
              organisationId: learner.providerOrg.id,
              evidenceItemId: saved.id,
              ksbDefinitionId: ksb.id,
            }),
          );
        }
      });
      await m.save(mappings);
      mappingCount += mappings.length;
    }

    console.log(
      `evidence: ${evidenceCount} items, ${mappingCount} KSB mappings`,
    );

    /**
     * ── MESSAGING (F3.4.2) ──────────────────────────────────────────────────
     *
     * Two threads per learner, because a thread is keyed on the counterparty
     * and the apprentice talks to both a tutor and a line manager. Unread is
     * expressed by the *absence or staleness* of a `message_thread_reads` row
     * rather than a flag, so some threads deliberately have no read marker for
     * the apprentice — that is what makes the unread badge non-zero.
     */
    let threadCount = 0;
    let messageCount = 0;

    for (const [learnerIndex, learner] of learners.entries()) {
      if (learner.spec.status === 'cancelled') continue;

      for (const [party, counterparty] of [
        [MessageThreadParty.TUTOR, learner.tutorUser],
        [MessageThreadParty.EMPLOYER_MANAGER, learner.managerUser],
      ] as const) {
        const thread = await m.save(
          m.create(MessageThread, {
            organisationId: learner.providerOrg.id,
            enrolmentId: learner.enrolment.id,
            apprenticeId: learner.apprentice.id,
            counterpartyParty: party,
            apprenticeUserId: learner.user.id,
            counterpartyUserId: counterparty.id,
            archivedAt: null,
          }),
        );
        threadCount += 1;

        const base = addDays(now, -14 + learnerIndex);
        const script: [string, string][] =
          party === MessageThreadParty.TUTOR
            ? [
                [
                  counterparty.id,
                  'How are you getting on with the off-the-job log this month?',
                ],
                [
                  learner.user.id,
                  'Behind by a couple of hours. Catching up on Friday.',
                ],
                [
                  counterparty.id,
                  'No problem. Bring the evidence to the next review.',
                ],
              ]
            : [
                [
                  counterparty.id,
                  'Reminder that your review is scheduled for next week.',
                ],
                [learner.user.id, 'Thanks, it is in my calendar.'],
              ];

        const messages = script.map(([senderUserId, body], i) =>
          m.create(Message, {
            organisationId: learner.providerOrg.id,
            threadId: thread.id,
            senderUserId,
            body,
          }),
        );
        const savedMessages = await m.save(messages);
        messageCount += savedMessages.length;

        /**
         * Every other tutor thread is left with no read marker for the
         * apprentice, so the unread count is genuinely non-zero rather than a
         * number that is always the same.
         */
        const leaveUnread =
          party === MessageThreadParty.TUTOR && learnerIndex % 2 === 0;
        if (!leaveUnread) {
          await m.save(
            m.create(MessageThreadRead, {
              organisationId: learner.providerOrg.id,
              threadId: thread.id,
              userId: learner.user.id,
              lastReadAt: addDays(base, 1),
            }),
          );
        }
        // The counterparty has always read their own thread.
        await m.save(
          m.create(MessageThreadRead, {
            organisationId: learner.providerOrg.id,
            threadId: thread.id,
            userId: counterparty.id,
            lastReadAt: addDays(base, 1),
          }),
        );
      }
    }

    console.log(`messaging: ${threadCount} threads, ${messageCount} messages`);

    /**
     * ── NOTIFICATIONS (F3.4.3) ──────────────────────────────────────────────
     *
     * One of every `NotificationType`, so the centre's filters and type icons
     * all have something to show, with roughly half left unread.
     *
     * Filed against the recipient's **own** organisation. `listForUser` filters
     * by the reader's active organisation, so a notification written under the
     * wrong tenant is invisible forever — the defect that made
     * `app_create_notification` necessary.
     */
    const NOTIFICATION_COPY: Record<NotificationType, [string, string]> = {
      [NotificationType.SYSTEM]: [
        'Scheduled maintenance',
        'Gradlly will be briefly unavailable on Sunday at 02:00.',
      ],
      [NotificationType.GENERIC]: [
        'Welcome to Gradlly',
        'Your account is ready. Take a look around.',
      ],
      [NotificationType.INVITATION]: [
        'You have been invited',
        'Your training provider has invited you to a programme.',
      ],
      [NotificationType.OTJ]: [
        'Off-the-job log approved',
        'Your entry for last week was approved.',
      ],
      [NotificationType.REVIEW]: [
        'Review scheduled',
        'Your next 12-weekly review is booked for next Tuesday.',
      ],
      [NotificationType.COMMITMENT]: [
        'Commitment statement ready to sign',
        'Your employer has signed. It is your turn.',
      ],
      [NotificationType.PORTFOLIO]: [
        'Evidence accepted',
        'Your tutor accepted "Sprint retrospective write-up".',
      ],
      [NotificationType.ILR_SUBMISSION_SUCCEEDED]: [
        'ILR submitted',
        'The ILR return was accepted by the ESFA.',
      ],
      [NotificationType.ILR_SUBMISSION_FAILED]: [
        'ILR submission failed',
        'The ESFA rejected the return. Check the validation errors.',
      ],
      [NotificationType.LEVY_EXPIRY_90]: [
        'Levy funds expiring in 90 days',
        '£7,800 of your levy expires within 90 days.',
      ],
      [NotificationType.LEVY_EXPIRY_30]: [
        'Levy funds expiring in 30 days',
        '£4,200 of your levy expires within 30 days.',
      ],
      [NotificationType.MESSAGE]: [
        'New message',
        'Your tutor sent you a message.',
      ],
      [NotificationType.CASELOAD_AT_RISK]: [
        'Caseload above threshold',
        'Four of your learners are flagged at risk.',
      ],
    };

    const notifications: Notification[] = [];
    const notificationTypes = Object.values(NotificationType);

    notificationTypes.forEach((type, i) => {
      const learner = learners[i % learners.length];
      // Levy and ILR notifications belong to the people who act on them.
      const toEmployer =
        type === NotificationType.LEVY_EXPIRY_30 ||
        type === NotificationType.LEVY_EXPIRY_90;
      const toTutor =
        type === NotificationType.ILR_SUBMISSION_SUCCEEDED ||
        type === NotificationType.ILR_SUBMISSION_FAILED ||
        type === NotificationType.CASELOAD_AT_RISK;

      const recipient = toEmployer
        ? learner.managerUser
        : toTutor
          ? learner.tutorUser
          : learner.user;
      const organisationId = toEmployer
        ? learner.employerOrg.id
        : learner.providerOrg.id;

      const [title, body] = NOTIFICATION_COPY[type];
      notifications.push(
        m.create(Notification, {
          userId: recipient.id,
          organisationId,
          type,
          title,
          body,
          readAt: i % 2 === 0 ? null : addDays(now, -2),
          metadata: { source: 'seed' },
        }),
      );
    });
    await m.save(notifications);
    console.log(
      `notifications: ${notifications.length} (one per type, half unread)`,
    );

    /**
     * ── OFSTED / EIF (F2.1.1, F2.1.2) ───────────────────────────────────────
     *
     * The overall percentage is deliberately below 75 for the first provider.
     * F2.1.1 shows a warning banner under that threshold, and a seed where
     * every provider is comfortably green leaves that banner unreachable.
     *
     * Twelve monthly snapshots per provider give the trend chart something to
     * plot; the criteria breakdown carries a red, an amber and a green so the
     * per-criterion RAG rendering is exercised in one screen.
     */
    const EIF_CRITERIA: { slug: string; label: string }[] = [
      { slug: 'quality-of-education', label: 'Quality of education' },
      { slug: 'behaviour-and-attitudes', label: 'Behaviour and attitudes' },
      { slug: 'personal-development', label: 'Personal development' },
      { slug: 'leadership-and-management', label: 'Leadership and management' },
    ];

    const ragFor = (percent: number): EifRag =>
      percent >= 75 ? EifRag.GREEN : percent >= 60 ? EifRag.AMBER : EifRag.RED;

    let snapshotCount = 0;
    let qipCount = 0;

    for (const [providerIndex, providerSpec] of PROVIDERS.entries()) {
      const providerOrg = orgBySlug.get(providerSpec.slug)!;
      const rand = makeRandom(700 + providerIndex);
      const tutor = userByEmail.get(providerSpec.contact.email)!;

      // First provider sits under 75 so the sub-threshold banner is reachable.
      const target = providerIndex === 0 ? 68 : 81;

      const snapshots: EifScoreSnapshot[] = [];
      for (let i = 11; i >= 0; i--) {
        const capturedOn = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
        );
        // Drift towards the target so the trend line moves rather than sits flat.
        const overall = Math.round(target - i * 0.8 + rand() * 4 - 2);
        snapshots.push(
          m.create(EifScoreSnapshot, {
            organisationId: providerOrg.id,
            capturedOn: iso(capturedOn),
            overallPercent: overall,
            overallRag: ragFor(overall),
            criteria: EIF_CRITERIA.map((c, idx) => {
              const percent = Math.max(
                35,
                Math.min(
                  96,
                  overall + (idx - 1) * 9 + Math.round(rand() * 6 - 3),
                ),
              );
              return {
                slug: c.slug,
                label: c.label,
                percent,
                rag: ragFor(percent),
              };
            }),
          }),
        );
      }
      await m.save(snapshots);
      snapshotCount += snapshots.length;

      /**
       * QIP actions, one of them overdue.
       *
       * "Overdue" here is a target date in the past on an action that is not
       * completed — the Ofsted hub highlights those, and without one the
       * overdue branch never renders.
       */
      const qips: QipAction[] = [];
      const qipPlan: [string, number, QipActionStatus][] = [
        [
          'Improve initial assessment consistency',
          -21,
          QipActionStatus.IN_PROGRESS,
        ],
        [
          'Refresh safeguarding training for all tutors',
          30,
          QipActionStatus.NOT_STARTED,
        ],
        [
          'Standardise feedback turnaround to 10 working days',
          62,
          QipActionStatus.IN_PROGRESS,
        ],
        [
          'Publish revised curriculum intent statement',
          -60,
          QipActionStatus.COMPLETED,
        ],
      ];

      qipPlan.forEach(([title, offsetDays, status], idx) => {
        qips.push(
          m.create(QipAction, {
            organisationId: providerOrg.id,
            title,
            description: `Raised from the ${EIF_CRITERIA[idx % EIF_CRITERIA.length].label} review.`,
            assignedOwnerUserId: tutor.id,
            targetCompletionDate: iso(addDays(now, offsetDays)),
            eifCriterionSlug: EIF_CRITERIA[idx % EIF_CRITERIA.length].slug,
            evidenceNotes:
              status === QipActionStatus.COMPLETED
                ? 'Signed off at the September quality board.'
                : null,
            evidenceAttachmentKeys: null,
            status,
          }),
        );
      });
      await m.save(qips);
      qipCount += qips.length;
    }

    console.log(
      `ofsted: ${snapshotCount} EIF snapshots, ${qipCount} QIP actions`,
    );

    console.log(`apprentices: ${APPRENTICES.length}`);
    console.log(`otj entries: ${otjCount}`);
    console.log(`reviews: ${reviewCount}`);
  });

  await ds.destroy();

  /**
   * Logins, printed because a seeded database nobody can sign into is not much
   * use. These are development credentials for a database the guards above have
   * already established is local.
   */
  console.log('\n─── logins ' + '─'.repeat(56));
  console.log('\nEmployer portal (localhost:3002)');
  for (const e of EMPLOYERS) {
    console.log(
      `  ${e.contact.email.padEnd(38)} ${e.contact.password.padEnd(22)} ${e.name}`,
    );
  }
  console.log('\nProvider portal (localhost:3004)');
  for (const pr of PROVIDERS) {
    console.log(
      `  ${pr.contact.email.padEnd(38)} ${pr.contact.password.padEnd(22)} ${pr.name}`,
    );
  }
  console.log('\nApprentice portal (localhost:3001)');
  for (const a of APPRENTICES) {
    console.log(
      `  ${a.email.padEnd(38)} ${a.password.padEnd(22)} ${a.first} ${a.last} — ${a.note ?? a.status}`,
    );
  }

  console.log('\n─── what to look at ' + '─'.repeat(48));
  console.log(
    [
      '  F1.1.2  employer / — amber and red levy expiry banners (21 and 61 days)',
      '  F1.1.3  employer /analytics — twelve months of contributions and spend',
      '  F1.1.5  employer /reports — funding payments including a clawback',
      '  F1.3.1  employer /commitments — every column, one awaiting each party',
      '  F3.3.2  apprentice /portfolio — heatmap cells in every state',
      '  F3.4.2  apprentice /messages — unread threads',
      '  F3.4.3  apprentice /settings — one notification of every type',
      '  F2.1.1  provider /ofsted-hub — first provider sits below 75%',
      '  F2.1.2  provider /ofsted-hub — one overdue QIP action',
    ].join('\n'),
  );

  console.log('\nseed complete');
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
