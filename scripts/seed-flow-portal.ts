/**
 * FlowPortal (Portal 4) seed — additive and idempotent.
 *
 * ── WHY THIS IS A SEPARATE SCRIPT FROM `seed-test-data.ts` ───────────────────
 *
 * `seed-test-data.ts` issues `DELETE FROM users` and eight other tables. It is
 * a *reset*, and its guards refuse anything but a local database for exactly
 * that reason. This script is designed to run against a shared or deployed
 * environment, so it does the opposite:
 *
 *   • It never DELETEs.
 *   • Every write is an upsert keyed on a natural identifier, so running it
 *     twice changes nothing the second time.
 *   • It leaves every existing organisation, user and membership untouched.
 *
 * That difference is the whole reason it exists. Merging the two would mean
 * either weakening the reset script's guards — the guards that stop someone
 * wiping a live database — or making this one unsafe to re-run.
 *
 * ── WHAT IT FIXES ───────────────────────────────────────────────────────────
 *
 * Portal 4 filters organisations by `portalType === 'flow'`
 * (`apps/flow/features/auth/hooks/useAuthUser.js`). No organisation in any
 * environment has that portal type, so every account resolves to zero
 * organisations and the portal is unreachable — not broken, unreachable. This
 * creates the flow organisations, their logins, and enough levy-exchange data
 * that the endpoints return something other than an empty list.
 *
 * ── RUNNING IT ──────────────────────────────────────────────────────────────
 *
 * Local:
 *   npx nest build
 *   SEED_ALLOW=yes node dist/scripts/seed-flow-portal.js
 *
 * Against a deployed database, the host must be named explicitly — no flag
 * that means "wherever DATABASE_URL happens to point", because that is how
 * the wrong database gets written to:
 *
 *   SEED_ALLOW=yes \
 *   SEED_REMOTE_HOST=<the exact host from your connection string> \
 *   DATABASE_URL=<connection string> \
 *   node dist/scripts/seed-flow-portal.js
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';

import { Apprentice } from '../src/apprentices/entities/apprentice.entity.js';
import { ApprenticeStatus } from '../src/apprentices/enums/apprentice-status.enum.js';
import AppDataSource from '../src/config/data-source.js';
import { Enrolment } from '../src/enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../src/enrolments/enums/enrolment-status.enum.js';
import { DasDonorLink } from '../src/levy-exchange/entities/das-donor-link.entity.js';
import { LevyMatchApplication } from '../src/levy-exchange/entities/levy-match-application.entity.js';
import { LevyRecipientProfile } from '../src/levy-exchange/entities/levy-recipient-profile.entity.js';
import { LevyTransferPreference } from '../src/levy-exchange/entities/levy-transfer-preference.entity.js';
import { LevyTransfer } from '../src/levy-exchange/entities/levy-transfer.entity.js';
import { DasDonorLinkStatus } from '../src/levy-exchange/enums/das-donor-link-status.enum.js';
import { LevyMatchApplicationStatus } from '../src/levy-exchange/enums/levy-match-application-status.enum.js';
import { LevyTransferStatus } from '../src/levy-exchange/enums/levy-transfer-status.enum.js';
import { OrganisationMembership } from '../src/organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../src/organisations/entities/organisation.entity.js';
import { MembershipStatus } from '../src/organisations/membership-status.enum.js';
import { OrganisationRole } from '../src/organisations/organisation-role.enum.js';
import { PortalType } from '../src/organisations/portal-type.enum.js';
import { Standard } from '../src/programmes/entities/standard.entity.js';
import { User } from '../src/users/entities/user.entity.js';

import type { EntityManager } from 'typeorm';

// ─── Data ────────────────────────────────────────────────────────────────────

/**
 * Two flow organisations, because FlowPortal has two sides and a single one
 * cannot exercise either: a levy donor with surplus to give away, and an SME
 * recipient looking for a transfer. A matching feature seeded with one party
 * demonstrates nothing.
 */
const FLOW_ORGS = [
  {
    slug: 'gradlly-flow-donor',
    name: 'Halloway Group PLC',
    city: 'London',
    postcode: 'EC3V 3ND',
    role: 'donor' as const,
    contact: {
      first: 'Eleanor',
      last: 'Whitfield',
      email: 'e.whitfield@hallowaygroup.co.uk',
      password: 'HallowayFlow2026!',
      jobTitle: 'Head of Social Impact',
    },
  },
  {
    slug: 'gradlly-flow-recipient',
    name: 'Kestrel Fabrication Ltd',
    city: 'Sheffield',
    postcode: 'S9 1TN',
    role: 'recipient' as const,
    contact: {
      first: 'Owen',
      last: 'Bradshaw',
      email: 'o.bradshaw@kestrelfab.co.uk',
      password: 'KestrelFlow2026!',
      jobTitle: 'Managing Director',
    },
  },
];

// ─── Guards ──────────────────────────────────────────────────────────────────

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
 * `NODE_ENV` is not consulted. This repository's own `.env` carries
 * `NODE_ENV=production` on a developer laptop pointed at `127.0.0.1`, so it
 * describes the build mode, not the database — trusting it would refuse local
 * runs and permit remote ones, which is exactly backwards.
 */
function assertAllowed(host: string): void {
  if (process.env.SEED_ALLOW !== 'yes') {
    throw new Error('Refusing to run without SEED_ALLOW=yes');
  }

  if (LOCAL_HOSTS.has(host)) return;

  const confirmed = process.env.SEED_REMOTE_HOST;
  if (!confirmed) {
    throw new Error(
      `Database host "${host}" is not local. This script is additive and safe ` +
        `to run remotely, but the target must be named on purpose: re-run with ` +
        `SEED_REMOTE_HOST="${host}".`,
    );
  }
  if (confirmed !== host) {
    throw new Error(
      `SEED_REMOTE_HOST="${confirmed}" does not match the host the connection ` +
        `actually resolves to ("${host}"). Refusing — this mismatch is what a ` +
        `stale environment variable looks like.`,
    );
  }
}

// ─── Upserts ─────────────────────────────────────────────────────────────────

async function upsertOrganisation(
  m: EntityManager,
  spec: (typeof FLOW_ORGS)[number],
): Promise<{ org: Organisation; created: boolean }> {
  const existing = await m.findOne(Organisation, {
    where: { slug: spec.slug },
  });
  if (existing) {
    // Repair the one field that makes the portal reachable, in case the row
    // predates this script or was created with the wrong type.
    if (existing.portalType !== PortalType.FLOW) {
      existing.portalType = PortalType.FLOW;
      await m.save(existing);
    }
    return { org: existing, created: false };
  }

  const org = await m.save(
    m.create(Organisation, {
      name: spec.name,
      slug: spec.slug,
      portalType: PortalType.FLOW,
      type: spec.role === 'donor' ? 'levy_donor' : 'levy_recipient',
      city: spec.city,
      postcode: spec.postcode,
      country: 'United Kingdom',
    }),
  );
  return { org, created: true };
}

async function upsertUser(
  m: EntityManager,
  spec: (typeof FLOW_ORGS)[number],
): Promise<{ user: User; created: boolean }> {
  const existing = await m.findOne(User, {
    where: { email: spec.contact.email },
  });
  if (existing) return { user: existing, created: false };

  const user = await m.save(
    m.create(User, {
      firstName: spec.contact.first,
      lastName: spec.contact.last,
      email: spec.contact.email,
      password: await bcrypt.hash(spec.contact.password, 10),
      isEmailVerified: true,
      isActive: true,
      jobTitle: spec.contact.jobTitle,
    }),
  );
  return { user, created: true };
}

async function upsertMembership(
  m: EntityManager,
  user: User,
  org: Organisation,
): Promise<boolean> {
  const existing = await m
    .createQueryBuilder(OrganisationMembership, 'om')
    .where('om.userId = :userId', { userId: user.id })
    .andWhere('om.organisationId = :orgId', { orgId: org.id })
    .andWhere('om.isDeleted = false')
    .getOne();
  if (existing) return false;

  await m.save(
    m.create(OrganisationMembership, {
      user,
      organisation: org,
      role: OrganisationRole.OWNER,
      status: MembershipStatus.ACTIVE,
    }),
  );
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const host = resolveHost();
  assertAllowed(host);

  const ds = await AppDataSource.initialize();
  console.log(`connected to host "${host}"`);

  const summary = {
    orgs: 0,
    users: 0,
    memberships: 0,
    profiles: 0,
    preferences: 0,
    donorLinks: 0,
    applications: 0,
    transfers: 0,
    apprentices: 0,
    enrolments: 0,
  };

  await ds.transaction(async (m) => {
    const bySlug = new Map<string, Organisation>();

    for (const spec of FLOW_ORGS) {
      const { org, created } = await upsertOrganisation(m, spec);
      bySlug.set(spec.slug, org);
      if (created) summary.orgs++;

      const { user, created: userCreated } = await upsertUser(m, spec);
      if (userCreated) summary.users++;
      if (await upsertMembership(m, user, org)) summary.memberships++;
    }

    const donor = bySlug.get('gradlly-flow-donor')!;
    const recipient = bySlug.get('gradlly-flow-recipient')!;

    // Recipient side — the profile is what makes an SME appear in the directory.
    if (
      !(await m.findOne(LevyRecipientProfile, {
        where: { organisationId: recipient.id },
      }))
    ) {
      await m.save(
        m.create(LevyRecipientProfile, {
          organisationId: recipient.id,
          sector: 'Engineering & Manufacturing',
          region: 'Yorkshire and the Humber',
          employeeCountBand: '50-249',
          programmeType: 'ST0145 Engineering Technician',
          transferAmountRequired: '21000.00',
          hasDasAccount: true,
          isListed: true,
        }),
      );
      summary.profiles++;
    }

    // Donor side — preferences drive the matching algorithm's filters.
    if (
      !(await m.findOne(LevyTransferPreference, {
        where: { organisationId: donor.id },
      }))
    ) {
      await m.save(
        m.create(LevyTransferPreference, {
          organisationId: donor.id,
          sectors: ['Engineering & Manufacturing', 'Health & Social Care'],
          regions: ['Yorkshire and the Humber', 'North West'],
          sizeBands: ['10-49', '50-249'],
          programmeTypes: ['ST0145 Engineering Technician'],
          maxPerRecipient: '25000.00',
          openMatching: true,
          anonymousMatching: false,
        }),
      );
      summary.preferences++;
    }

    // A linked DAS account, so the donor dashboard has a balance to show.
    if (
      !(await m.findOne(DasDonorLink, { where: { organisationId: donor.id } }))
    ) {
      await m.save(
        m.create(DasDonorLink, {
          organisationId: donor.id,
          label: 'Halloway Group levy account',
          dasAccountId: 'LEV-2026-HWG',
          ukprn: null,
          status: DasDonorLinkStatus.LINKED,
          consentedAt: new Date(),
          lastSyncedAt: new Date(),
          lastBalance: '184500.00',
        }),
      );
      summary.donorLinks++;
    }

    /**
     * One application and one transfer, so the matching and transfer screens
     * are exercised against real rows rather than empty lists. Deliberately
     * left mid-flow — `pending` and `pending_signatures` — because the
     * interesting states of this feature are the ones in progress, and a seed
     * consisting only of completed records tests nothing that matters.
     */
    let application = await m.findOne(LevyMatchApplication, {
      where: {
        donorOrganisationId: donor.id,
        recipientOrganisationId: recipient.id,
      },
    });
    if (!application) {
      application = await m.save(
        m.create(LevyMatchApplication, {
          donorOrganisationId: donor.id,
          recipientOrganisationId: recipient.id,
          requestedAmount: '21000.00',
          status: LevyMatchApplicationStatus.PENDING,
          matchScore: '87.50',
          scoreBreakdown: { sector: 40, region: 30, size: 17.5 },
        }),
      );
      summary.applications++;
    }

    /**
     * Two transfers, deliberately in different states.
     *
     * `pending_signatures` shows the mid-flow case, which is the one worth
     * demonstrating on screen. `confirmed` exists because a transfer can only
     * fund an enrolment once it is confirmed or active (F4.1.4 AC1) — with
     * only the pending one, the funding link could not be exercised at all and
     * the donor's learner count would always read zero.
     */
    let confirmedTransfer = await m.findOne(LevyTransfer, {
      where: {
        donorOrganisationId: donor.id,
        recipientOrganisationId: recipient.id,
        status: LevyTransferStatus.CONFIRMED,
      },
    });

    if (
      !(await m.findOne(LevyTransfer, {
        where: {
          donorOrganisationId: donor.id,
          recipientOrganisationId: recipient.id,
          status: LevyTransferStatus.PENDING_SIGNATURES,
        },
      }))
    ) {
      await m.save(
        m.create(LevyTransfer, {
          donorOrganisationId: donor.id,
          recipientOrganisationId: recipient.id,
          matchApplicationId: application.id,
          amount: '21000.00',
          programmeDetails: {
            standard: 'ST0145',
            title: 'Engineering Technician L3',
          },
          status: LevyTransferStatus.PENDING_SIGNATURES,
          startDate: new Date().toISOString().slice(0, 10),
        }),
      );
      summary.transfers++;
    }

    if (!confirmedTransfer) {
      confirmedTransfer = await m.save(
        m.create(LevyTransfer, {
          donorOrganisationId: donor.id,
          recipientOrganisationId: recipient.id,
          amount: '27000.00',
          programmeDetails: {
            standard: 'ST0415',
            title: 'Software Developer L4',
          },
          status: LevyTransferStatus.CONFIRMED,
          startDate: new Date().toISOString().slice(0, 10),
          confirmedAt: new Date(),
          esfaTransferReference: 'ESFA-TEST-0001',
        }),
      );
      summary.transfers++;
    }

    /**
     * A learner at the recipient SME, delivered by a provider.
     *
     * Without this the funding link has nothing to point at: the SME had no
     * enrolments, so "number of learners funded" could never be anything but
     * zero and the cross-portal chain — donor pays, provider delivers, SME
     * employs — could not be demonstrated end to end.
     *
     * `organisationId` is the *provider* (they own the enrolment record);
     * `employerOrganisationId` is the SME. That split is what the funding
     * service validates against.
     */
    const provider = await m.findOne(Organisation, {
      where: { slug: 'northern-futures' },
    });

    if (provider) {
      let apprentice = await m.findOne(Apprentice, {
        where: { email: 'j.reeve@kestrelfab.co.uk' },
      });
      if (!apprentice) {
        apprentice = await m.save(
          m.create(Apprentice, {
            organisationId: provider.id,
            firstName: 'Jordan',
            lastName: 'Reeve',
            email: 'j.reeve@kestrelfab.co.uk',
            jobTitle: 'Apprentice Software Developer',
            status: ApprenticeStatus.ACTIVE,
          }),
        );
        summary.apprentices++;
      }

      const standard = await m.findOne(Standard, {
        where: { organisationId: provider.id, code: 'ST0415' },
      });

      if (
        standard &&
        !(await m.findOne(Enrolment, {
          where: { apprenticeId: apprentice.id, standardId: standard.id },
        }))
      ) {
        await m.save(
          m.create(Enrolment, {
            organisationId: provider.id,
            apprenticeId: apprentice.id,
            standardId: standard.id,
            status: EnrolmentStatus.ACTIVE,
            activatedAt: new Date(),
            plannedStartDate: new Date().toISOString().slice(0, 10),
            plannedDurationMonths: 24,
            employerOrganisationId: recipient.id,
            providerOrganisationId: provider.id,
          }),
        );
        summary.enrolments++;
      }
    }
  });

  await ds.destroy();

  console.log('\nFlowPortal seed complete (additive — nothing was deleted):');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k.padEnd(14)} ${v} created`);
  }
  console.log('\nLogins:');
  for (const s of FLOW_ORGS) {
    console.log(
      `  ${s.role.padEnd(10)} ${s.contact.email}  /  ${s.contact.password}`,
    );
  }
  console.log(
    '\nRe-running makes no further changes — every write is an upsert.',
  );
}

main().catch((err) => {
  console.error('FLOW SEED FAILED:', err);
  process.exit(1);
});
