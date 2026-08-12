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
 * This script issues `DELETE FROM users` and eight other tables. Against
 * production it would destroy every real account, so it refuses to run unless
 * `SEED_ALLOW=yes`, the database **host** is local, and the database **name**
 * is one of the known dev names. See the guards in `main()` for why `NODE_ENV`
 * is not trusted here.
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
import AppDataSource from '../src/config/data-source.js';
import { Enrolment } from '../src/enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../src/enrolments/enums/enrolment-status.enum.js';
import { OrganisationMembership } from '../src/organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../src/organisations/entities/organisation.entity.js';
import { OrganisationRole } from '../src/organisations/organisation-role.enum.js';
import { PortalType } from '../src/organisations/portal-type.enum.js';
import { OtjLogEntry } from '../src/otj/entities/otj-log-entry.entity.js';
import { OtjActivityCategory } from '../src/otj/enums/otj-activity-category.enum.js';
import { OtjLogStatus } from '../src/otj/enums/otj-log-status.enum.js';
import { KsbDefinition } from '../src/portfolio/entities/ksb-definition.entity.js';
import { KsbKind } from '../src/portfolio/enums/ksb-kind.enum.js';
import { Programme } from '../src/programmes/entities/programme.entity.js';
import { Standard } from '../src/programmes/entities/standard.entity.js';
import { Review } from '../src/reviews/entities/review.entity.js';
import { ReviewStatus } from '../src/reviews/enums/review-status.enum.js';
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
    }

    console.log(`apprentices: ${APPRENTICES.length}`);
    console.log(`otj entries: ${otjCount}`);
    console.log(`reviews: ${reviewCount}`);
  });

  await ds.destroy();
  console.log('\nseed complete');
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
