import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../../src/common/constants/organisation-headers.js';

import { createVerifiedUser } from './e2e-http.js';
import { buildOrgPayload } from './e2e-organisation.js';
import { createE2ePgClient } from './rls-db.js';

import type { INestApplication } from '@nestjs/common';
import type { Client } from 'pg';
import type { App } from 'supertest/types';

/**
 * Two learners under one provider organisation.
 *
 * WHY THIS HELPER EXISTS. Every pre-existing fixture in this suite creates
 * exactly one apprentice per organisation, so the suite has been structurally
 * incapable of expressing "two learners at one provider" — and a suite that
 * cannot express the scenario will never fail on it. That is the reason survey
 * finding 4 sat unverified for as long as it did, not an oversight in any one
 * test.
 *
 * WHAT A LEARNER IS, CONCRETELY. There is no learner role in this platform.
 * An apprentice who accepts their invitation becomes
 * `role: OrganisationRole.MEMBER` of the *provider's* organisation
 * (`invitations.service.ts:253`) — the same row shape a tutor gets. The only
 * thing that distinguishes them anywhere in the schema is
 * `enrolments.apprenticeUserId`. This fixture reproduces exactly that: a
 * member row plus an enrolment pointing back at the user.
 *
 * Memberships and `apprenticeUserId` are written with the superuser client
 * rather than through the invitation endpoint because the real flow needs an
 * email round trip, and none of that is the property under test.
 */
export interface ILearnerFixture {
  userId: string;
  accessToken: string;
  apprenticeId: string;
  enrolmentId: string;
  /** An `approved` entry, so it counts toward pace figures. */
  approvedOtjEntryId: string;
  /** A `submitted` entry, so pending figures are non-zero. */
  submittedOtjEntryId: string;
  /** Unique marker embedded in this learner's OTJ activity names. */
  marker: string;
  /** Marker on this learner's review title. */
  reviewMarker: string;
  reviewId: string;
  /** Marker on this learner's portfolio evidence title. */
  evidenceMarker: string;
  evidenceId: string;
  headers: Record<string, string>;
}

export interface ILearnerScopeContext {
  providerOrgId: string;
  employerOrgId: string;
  standardId: string;
  /** The provider owner — staff, must keep full visibility after the fix. */
  staffHeaders: Record<string, string>;
  staffUserId: string;
  learnerA: ILearnerFixture;
  learnerB: ILearnerFixture;
  sudo: Client;
}

async function seedLearner(
  app: INestApplication<App>,
  sudo: Client,
  opts: {
    providerOrgId: string;
    employerOrgId: string;
    standardId: string;
    staffHeaders: Record<string, string>;
    label: string;
    suffix: number;
  },
): Promise<ILearnerFixture> {
  const { providerOrgId, employerOrgId, standardId, staffHeaders, label } =
    opts;
  const marker = `LEARNER-${label.toUpperCase()}-PRIVATE`;

  // The apprentice record — created through the real endpoint so the fixture
  // exercises the same validation a provider would hit.
  const apprenticeRes = await request(app.getHttpServer())
    .post('/api/v1/apprentices')
    .set(staffHeaders)
    .send({
      firstName: label,
      lastName: 'Learner',
      email: `scope-${label}-${opts.suffix}@example.com`,
    })
    .expect(201);
  const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data.id;

  const enrolmentRes = await request(app.getHttpServer())
    .post('/api/v1/enrolments')
    .set(staffHeaders)
    .send({ apprenticeId, standardId, agreedPrice: 15000 })
    .expect(201);
  const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

  await request(app.getHttpServer())
    .patch(`/api/v1/enrolments/${enrolmentId}/organisation-links`)
    .set(staffHeaders)
    .send({ employerOrganisationId: employerOrgId })
    .expect(200);

  await request(app.getHttpServer())
    .post(`/api/v1/enrolments/${enrolmentId}/activate`)
    .set(staffHeaders)
    .expect(201);

  // The learner's own login, joined to the provider org as a plain member —
  // byte-identical to what a tutor holds.
  const user = await createVerifiedUser(app, {
    email: `scope-user-${label}-${opts.suffix}@example.com`,
  });
  await sudo.query(
    `INSERT INTO organisation_memberships ("organisationId", "userId", role, status)
     VALUES ($1, $2, 'member', 'active')`,
    [providerOrgId, user.userId],
  );

  // The one column in the schema that says "this user is that apprentice".
  await sudo.query(
    `UPDATE enrolments SET "apprenticeUserId" = $1 WHERE id = $2`,
    [user.userId, enrolmentId],
  );

  const approved = await sudo.query<{ id: string }>(
    `INSERT INTO otj_log_entries
       ("organisationId", "enrolmentId", "apprenticeId", "loggedDate", minutes,
        "activityName", category, status, "approvedAt")
     VALUES ($1, $2, $3, CURRENT_DATE, 120, $4, 'other', 'approved', NOW())
     RETURNING id`,
    [providerOrgId, enrolmentId, apprenticeId, `${marker}-APPROVED`],
  );

  const submitted = await sudo.query<{ id: string }>(
    `INSERT INTO otj_log_entries
       ("organisationId", "enrolmentId", "apprenticeId", "loggedDate", minutes,
        "activityName", category, status, "submittedAt")
     VALUES ($1, $2, $3, CURRENT_DATE, 90, $4, 'other', 'submitted', NOW())
     RETURNING id`,
    [providerOrgId, enrolmentId, apprenticeId, `${marker}-SUBMITTED`],
  );

  /**
   * A review and a portfolio item per learner, so the row-level assertions on
   * `/reviews` and `/ksb-evidence-items` have something to be wrong about. A
   * "learner cannot see B's review" test against an empty table passes whether
   * or not the guard exists — which is not cover, it is decoration.
   */
  const reviewMarker = `${marker}-REVIEW`;
  const review = await sudo.query<{ id: string }>(
    `INSERT INTO reviews
       ("organisationId", "enrolmentId", "apprenticeId", "scheduledAt", title,
        status, "apprenticeUserId", "tutorUserId", "employerManagerUserId")
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 days', $4, 'scheduled', $5, $5, $5)
     RETURNING id`,
    [providerOrgId, enrolmentId, apprenticeId, reviewMarker, user.userId],
  );

  const evidenceMarker = `${marker}-EVIDENCE`;
  const evidence = await sudo.query<{ id: string }>(
    `INSERT INTO ks_evidence_items
       ("organisationId", "enrolmentId", "apprenticeId", title, type, status)
     VALUES ($1, $2, $3, $4, 'text', 'draft')
     RETURNING id`,
    [providerOrgId, enrolmentId, apprenticeId, evidenceMarker],
  );

  return {
    userId: user.userId,
    accessToken: user.accessToken,
    apprenticeId,
    enrolmentId,
    approvedOtjEntryId: approved.rows[0].id,
    submittedOtjEntryId: submitted.rows[0].id,
    marker,
    reviewMarker,
    reviewId: review.rows[0].id,
    evidenceMarker,
    evidenceId: evidence.rows[0].id,
    headers: {
      Authorization: `Bearer ${user.accessToken}`,
      [ORGANISATION_ID_HEADER]: providerOrgId,
    },
  };
}

export async function createLearnerScopeContext(
  app: INestApplication<App>,
  label: string,
): Promise<ILearnerScopeContext> {
  const suffix = Date.now() + Math.floor(Math.random() * 1000);
  const sudo = createE2ePgClient();
  await sudo.connect();

  const owner = await createVerifiedUser(app, {
    email: `scope-owner-${label}-${suffix}@example.com`,
  });

  const providerRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      ...buildOrgPayload(`Scope Provider ${label} ${suffix}`),
      portalType: 'provider',
      city: 'London',
    })
    .expect(201);
  const providerOrgId = (providerRes.body as { data: { id: string } }).data.id;

  const employerRes = await request(app.getHttpServer())
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({
      ...buildOrgPayload(`Scope Employer ${label} ${suffix}`),
      portalType: 'employer',
      city: 'London',
    })
    .expect(201);
  const employerOrgId = (employerRes.body as { data: { id: string } }).data.id;

  const staffHeaders: Record<string, string> = {
    Authorization: `Bearer ${owner.accessToken}`,
    [ORGANISATION_ID_HEADER]: providerOrgId,
  };

  const programmeRes = await request(app.getHttpServer())
    .post('/api/v1/programmes')
    .set(staffHeaders)
    .send({
      code: `SCOPE-PROG-${suffix}`,
      title: 'Scope Programme',
      status: 'active',
    })
    .expect(201);
  const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

  const standardRes = await request(app.getHttpServer())
    .post('/api/v1/standards')
    .set(staffHeaders)
    .send({
      programmeId,
      code: `SCOPE-STD-${suffix}`,
      title: 'Scope Standard',
      status: 'active',
    })
    .expect(201);
  const standardId = (standardRes.body as { data: { id: string } }).data.id;

  const learnerA = await seedLearner(app, sudo, {
    providerOrgId,
    employerOrgId,
    standardId,
    staffHeaders,
    label: 'alpha',
    suffix,
  });
  const learnerB = await seedLearner(app, sudo, {
    providerOrgId,
    employerOrgId,
    standardId,
    staffHeaders,
    label: 'bravo',
    suffix: suffix + 1,
  });

  return {
    providerOrgId,
    employerOrgId,
    standardId,
    staffHeaders,
    staffUserId: owner.userId,
    learnerA,
    learnerB,
    sudo,
  };
}
