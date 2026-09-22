import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';

import { QUEUE_EMAIL } from '../../src/bullmq/bullmq.constants.js';
import { EmailSendProcessor } from '../../src/bullmq/processors/email-send.processor.js';
import { runWithTenantContext } from '../../src/common/context/correlation-id-context.js';
import { EMAIL_JOB_SEND } from '../../src/email/email-job.constants.js';
import { EmailPayloadFactory } from '../../src/email/email-payload.factory.js';
import { EmailTemplate } from '../../src/email/email-template.enum.js';
import { EmailService } from '../../src/email/email.service.js';
import {
  EMAIL_SENDER,
  type IEmailMessage,
  type IEmailSender,
} from '../../src/email/interfaces/email-sender.interface.js';
import { DasLevyTranche } from '../../src/levy-exchange/entities/das-levy-tranche.entity.js';
import { LevyExpiryAlertDispatch } from '../../src/levy-exchange/entities/levy-expiry-alert-dispatch.entity.js';
import { LevyExpiryAlertService } from '../../src/levy-exchange/services/levy-expiry-alert.service.js';
import { createE2eApp } from '../helpers/e2e-app.js';
import {
  applyTenantContext,
  createLexOrgContext,
  seedDonorLink,
  seedLinkedDonor,
} from '../helpers/levy-exchange-e2e.js';

import type { IEmailJobPayload } from '../../src/email/email-job.payload.js';
import type { INestApplication } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import type { App } from 'supertest/types';
import type { Repository } from 'typeorm';

/**
 * F1.1.2 AC4 — the 90-day and 30-day warnings before levy funds expire,
 * proved by sending them, not by compiling a template.
 *
 * The two templates had only an \`.html.njk\`, and the renderer reads the
 * subject and text parts unconditionally, so every one of these emails
 * failed in the email worker and was never delivered — while the alert
 * sweep recorded a dispatch and reported success.
 *
 * The whole path runs here: the sweep, as the cron runs it (no tenant, RLS
 * bootstrap for its own reads), through the per-type preference check and
 * onto the real email queue; then the job taken off that queue and run
 * through the email worker's processor, the real renderer and templates,
 * to the sender. Only the sender is a double, so what it receives is
 * exactly what would have gone out.
 *
 * The portal URLs are the one thing configured here, because .env.test sets
 * none and the link would otherwise be "#": the employer and the flow portal
 * get distinct hosts, so a link built from the wrong one cannot pass.
 */
describe('F1.1.2 AC4 — levy expiry alert emails are sent (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  const utcDaysAhead = (days: number): string => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  it('sends the 90-day and the 30-day warning, rendered in full, to the employer owner', async () => {
    const ctx = await createLexOrgContext(app, 'expiry-email');
    const { linkId } = await seedDonorLink(app, ctx, { label: 'Levy HQ' });
    await seedLinkedDonor(app, ctx, linkId);

    const in90 = utcDaysAhead(90);
    const in30 = utcDaysAhead(30);
    applyTenantContext(ctx);
    const trancheRepo = app.get<Repository<DasLevyTranche>>(
      getRepositoryToken(DasLevyTranche),
    );
    const t90 = await trancheRepo.save(
      trancheRepo.create({
        organisationId: ctx.orgId,
        donorLinkId: linkId,
        amount: '12500.00',
        expiresOn: in90,
        rawPayload: null,
      }),
    );
    const t30 = await trancheRepo.save(
      trancheRepo.create({
        organisationId: ctx.orgId,
        donorLinkId: linkId,
        amount: '3400.50',
        expiresOn: in30,
        rawPayload: null,
      }),
    );

    const portalUrls = new Map([
      ['employer', 'https://employer.portal.test/'],
      ['flow', 'https://flow.portal.test'],
    ]);
    const config = app.get(ConfigService);
    const realGet = config.get.bind(config);
    const configSpy = jest
      .spyOn(config, 'get')
      .mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'app.frontend.portalUrls') {
          return Object.fromEntries(portalUrls);
        }
        if (key.startsWith('app.frontend.portalUrls.')) {
          return portalUrls.get(key.slice('app.frontend.portalUrls.'.length));
        }
        return defaultValue === undefined
          ? realGet(key)
          : realGet(key, defaultValue);
      });

    // As the cron runs it: a context of its own, no organisation, no user.
    try {
      await runWithTenantContext({ label: 'e2e:levy-expiry-alerts-cron' }, () =>
        app.get(LevyExpiryAlertService).sendDueAlerts(),
      );
    } finally {
      configSpy.mockRestore();
    }

    // Both alerts recorded as dispatched for this employer's tranches.
    const dispatches = await runWithTenantContext(
      {
        label: 'e2e:levy-expiry-check',
        organisationId: ctx.orgId,
        userId: ctx.user.userId,
      },
      () =>
        app
          .get<
            Repository<LevyExpiryAlertDispatch>
          >(getRepositoryToken(LevyExpiryAlertDispatch))
          .find({ where: { organisationId: ctx.orgId } }),
    );
    expect(dispatches.map((d) => d.trancheId).sort()).toEqual(
      [t90.id, t30.id].sort(),
    );

    // The jobs the sweep put on the real email queue for this recipient.
    const queue = app.get<Queue<IEmailJobPayload>>(getQueueToken(QUEUE_EMAIL));
    const queued = (
      await queue.getJobs(['waiting', 'delayed', 'prioritized', 'paused'])
    ).filter(
      (job) =>
        job?.data?.to === ctx.user.email &&
        // The sign-up verification email for this user is queued too.
        job.data.template !== EmailTemplate.EMAIL_VERIFICATION,
    );
    expect(queued.map((job) => job.data.template).sort()).toEqual(
      [EmailTemplate.LEVY_EXPIRY_30, EmailTemplate.LEVY_EXPIRY_90].sort(),
    );

    // Through the email worker's processor to the sender.
    const sent: IEmailMessage[] = [];
    const sender = app.get<IEmailSender>(EMAIL_SENDER);
    const spy = jest
      .spyOn(sender, 'send')
      .mockImplementation((message: IEmailMessage) => {
        sent.push(message);
        return Promise.resolve();
      });
    const processor = new EmailSendProcessor(
      app.get(EmailPayloadFactory),
      app.get(EmailService),
    );
    try {
      for (const job of queued) {
        await processor.process({
          id: job.id,
          name: EMAIL_JOB_SEND,
          data: job.data,
        } as Job<IEmailJobPayload>);
      }
    } finally {
      spy.mockRestore();
      for (const job of queued) {
        await job.remove();
      }
    }

    expect(sent).toHaveLength(2);
    const byDays = (days: number) => {
      const message = sent.find((m) => m.subject.includes(`${days} days`));
      if (!message) throw new Error(`no ${days}-day email was sent`);
      return message;
    };

    // The amount as levy-roi-monthly writes one: a pound sign in HTML, GBP
    // in the subject and the text part.
    const ninety = byDays(90);
    expect(ninety.to).toBe(ctx.user.email);
    expect(ninety.subject).toContain('GBP 12500.00');
    expect(ninety.text).toContain('GBP 12500.00');
    expect(ninety.html).toContain('<strong>£12500.00</strong>');
    expect(ninety.text).toContain(in90);
    expect(ninety.text).toContain('in 90 days');
    expect(ninety.html).toContain(`<strong>${in90}</strong>`);

    const thirty = byDays(30);
    expect(thirty.subject).toContain('GBP 3400.50');
    expect(thirty.text).toContain('GBP 3400.50');
    expect(thirty.html).toContain('<strong>£3400.50</strong>');
    expect(thirty.text).toContain(in30);
    expect(thirty.text).toContain('in 30 days');
    for (const message of [ninety, thirty]) {
      // The employer portal's Levy Transfer page — the recipients are the
      // employer's owners and admins, not an SME in the flow portal.
      expect(message.html).toContain(
        'href="https://employer.portal.test/levy-transfer"',
      );
      expect(message.text).toContain(
        'https://employer.portal.test/levy-transfer',
      );
      expect(message.html).not.toContain('flow.portal.test');
      expect(message.text).not.toContain('flow.portal.test');
      expect(message.subject.trim()).not.toBe('');
      expect(message.text).not.toContain('{{');
      expect(message.html).not.toContain('{{');
    }
  });
});
