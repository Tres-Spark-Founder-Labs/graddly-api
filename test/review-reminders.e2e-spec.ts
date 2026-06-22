import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';

import { ORGANISATION_ID_HEADER } from '../src/common/constants/organisation-headers.js';
import {
  setCurrentOrganisationId,
  setCurrentUserId,
} from '../src/common/context/correlation-id-context.js';
import { setLastKnownUserIdForGuc } from '../src/database/apply-tenant-gucs.js';
import { ReviewReminderDispatch } from '../src/reviews/entities/review-reminder-dispatch.entity.js';
import { Review } from '../src/reviews/entities/review.entity.js';
import { ReviewReminderKind } from '../src/reviews/enums/review-reminder-kind.enum.js';
import { ReviewsReminderService } from '../src/reviews/reviews-reminder.service.js';

import { createE2eApp } from './helpers/e2e-app.js';
import { createVerifiedUser } from './helpers/e2e-http.js';
import { buildOrgPayload } from './helpers/e2e-organisation.js';

import type { App } from 'supertest/types';
import type { Repository } from 'typeorm';

describe('Review reminders (e2e)', () => {
  let app: INestApplication<App>;
  let dispatchRepo: Repository<ReviewReminderDispatch>;
  let reviewRepo: Repository<Review>;

  beforeAll(async () => {
    app = await createE2eApp();
    dispatchRepo = app.get(getRepositoryToken(ReviewReminderDispatch));
    reviewRepo = app.get(getRepositoryToken(Review));
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends apprentice-only 48h review reminder', async () => {
    const suffix = Date.now();
    const owner = await createVerifiedUser(app, {
      email: `reminder-owner-${suffix}@example.com`,
    });
    const apprentice = await createVerifiedUser(app, {
      email: `reminder-apprentice-${suffix}@example.com`,
    });
    const tutor = await createVerifiedUser(app, {
      email: `reminder-tutor-${suffix}@example.com`,
    });
    const manager = await createVerifiedUser(app, {
      email: `reminder-manager-${suffix}@example.com`,
    });

    const orgRes = await request(app.getHttpServer())
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send(buildOrgPayload(`Reminder Org ${suffix}`))
      .expect(201);
    const orgId = (orgRes.body as { data: { id: string } }).data.id;

    const programmeRes = await request(app.getHttpServer())
      .post('/api/v1/programmes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        code: `REM-PROG-${suffix}`,
        title: 'Reminder Programme',
        status: 'active',
      })
      .expect(201);
    const programmeId = (programmeRes.body as { data: { id: string } }).data.id;

    const standardRes = await request(app.getHttpServer())
      .post('/api/v1/standards')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        programmeId,
        code: `REM-STD-${suffix}`,
        title: 'Reminder Standard',
        status: 'active',
      })
      .expect(201);
    const standardId = (standardRes.body as { data: { id: string } }).data.id;

    const apprenticeRes = await request(app.getHttpServer())
      .post('/api/v1/apprentices')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        firstName: 'Reminder',
        lastName: 'Apprentice',
        email: apprentice.email,
      })
      .expect(201);
    const apprenticeId = (apprenticeRes.body as { data: { id: string } }).data
      .id;

    const enrolmentRes = await request(app.getHttpServer())
      .post('/api/v1/enrolments')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({ apprenticeId, standardId })
      .expect(201);
    const enrolmentId = (enrolmentRes.body as { data: { id: string } }).data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/enrolments/${enrolmentId}/participants`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        apprenticeUserId: apprentice.userId,
        tutorUserId: tutor.userId,
        employerManagerUserId: manager.userId,
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/enrolments/${enrolmentId}/activate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .expect(201);

    const scheduledAt = new Date(
      Date.now() + 48 * 60 * 60 * 1000,
    ).toISOString();

    const reviewRes = await request(app.getHttpServer())
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set(ORGANISATION_ID_HEADER, orgId)
      .send({
        enrolmentId,
        apprenticeId,
        scheduledAt,
        title: '48h reminder review',
        apprenticeUserId: apprentice.userId,
        tutorUserId: tutor.userId,
        employerManagerUserId: manager.userId,
      })
      .expect(201);
    const reviewId = (reviewRes.body as { data: { id: string } }).data.id;

    setCurrentOrganisationId(orgId);
    setCurrentUserId(owner.userId);
    setLastKnownUserIdForGuc(owner.userId);

    await reviewRepo.update(reviewId, {
      scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });

    const reminderService = app.get(ReviewsReminderService);
    await reminderService.sendDueReminders();

    const dispatch = await dispatchRepo.findOne({
      where: { reviewId, reminderKind: ReviewReminderKind.FORTY_EIGHT_HOURS },
    });
    expect(dispatch).toBeTruthy();
  });
});
