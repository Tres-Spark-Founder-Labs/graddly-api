import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailTemplate } from '../email/email-template.enum.js';
import { EpaPackReadyEmail } from '../email/payloads/epa-pack-ready.email.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { StorageService } from '../storage/storage.service.js';
import { User } from '../users/entities/user.entity.js';

import { EpaPackJob } from './entities/epa-pack-job.entity.js';
import { EpaPackJobStatus } from './enums/epa-pack-job-status.enum.js';
import { EpaPackEmailService } from './epa-pack-email.service.js';

/**
 * F3.3.4 AC5 — the download link is emailed once per completed job.
 *
 * The claim is a conditional UPDATE; these tests drive it through what the
 * query builder reports as `affected`, and check that the marker is released
 * on every outcome except a queued email.
 */
describe('EpaPackEmailService', () => {
  let service: EpaPackEmailService;

  const execute = jest.fn();
  const where = jest.fn();
  const set = jest.fn();
  const update = jest.fn();
  const createQueryBuilder = jest.fn();
  const jobFindOne = jest.fn();
  const jobUpdate = jest.fn();
  const userFindOne = jest.fn();
  const createDownloadUrl = jest.fn();
  const sendEmail = jest.fn();

  const completedJob = {
    id: 'job-1',
    organisationId: 'org-1',
    enrolmentId: 'enrol-1',
    requestedByUserId: 'user-1',
    status: EpaPackJobStatus.COMPLETED,
    outputKey: 'orgs/org-1/export/obj/epa-evidence-pack-job-1.zip',
    downloadEmailSentAt: new Date('2026-09-22T09:15:00.000Z'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // jobRepo.createQueryBuilder().update(EpaPackJob).set(...).where(...).execute()
    where.mockReturnValue({ execute });
    set.mockReturnValue({ where });
    update.mockReturnValue({ set });
    createQueryBuilder.mockReturnValue({ update });
    execute.mockResolvedValue({ affected: 1 });
    jobFindOne.mockResolvedValue(completedJob);
    jobUpdate.mockResolvedValue({ affected: 1 });
    userFindOne.mockResolvedValue({
      id: 'user-1',
      email: 'sam@example.com',
      firstName: 'Sam',
    });
    createDownloadUrl.mockResolvedValue({
      downloadUrl: 'https://bucket.example.com/pack.zip?X-Amz-Expires=86400',
      expiresAt: new Date('2026-09-23T09:15:00.000Z'),
    });
    sendEmail.mockResolvedValue('queued');

    const moduleRef = await Test.createTestingModule({
      providers: [
        EpaPackEmailService,
        {
          provide: getRepositoryToken(EpaPackJob),
          useValue: {
            createQueryBuilder,
            findOne: jobFindOne,
            update: jobUpdate,
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: userFindOne },
        },
        { provide: StorageService, useValue: { createDownloadUrl } },
        { provide: NotificationsService, useValue: { sendEmail } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: unknown) =>
              new Map<string, unknown>([
                ['app.epaPack.emailLinkTtlSeconds', 86400],
                [
                  'app.frontend.portalUrls',
                  { apprentice: 'https://me.example.com' },
                ],
              ]).get(key) ?? fallback,
          },
        },
      ],
    }).compile();
    service = moduleRef.get(EpaPackEmailService);
  });

  it('claims the marker on a completed, unemailed job and queues the link with the emailed-link TTL', async () => {
    const outcome = await service.sendDownloadLink('job-1');

    expect(outcome).toBe('queued');
    expect(update).toHaveBeenCalledWith(EpaPackJob);
    expect(where).toHaveBeenCalledWith(
      'id = :jobId AND status = :status AND "downloadEmailSentAt" IS NULL',
      { jobId: 'job-1', status: EpaPackJobStatus.COMPLETED },
    );
    expect(createDownloadUrl).toHaveBeenCalledWith(
      'org-1',
      { key: completedJob.outputKey },
      { expiresInSeconds: 86400 },
    );
    const [sent] = sendEmail.mock.calls as [
      [{ userId: string; type: NotificationType; payload: EpaPackReadyEmail }],
    ];
    expect(sent[0].userId).toBe('user-1');
    expect(sent[0].type).toBe(NotificationType.PORTFOLIO);
    expect(sent[0].payload).toBeInstanceOf(EpaPackReadyEmail);
    expect(sent[0].payload.template).toBe(EmailTemplate.EPA_PACK_READY);
    expect(sent[0].payload.to).toBe('sam@example.com');
    expect(sent[0].payload.getTemplateContext()).toMatchObject({
      firstName: 'Sam',
      downloadUrl: 'https://bucket.example.com/pack.zip?X-Amz-Expires=86400',
      expiresInLabel: '24 hours',
      packPageUrl: 'https://me.example.com/epa-pack',
    });
    // Queued: the marker stays.
    expect(jobUpdate).not.toHaveBeenCalled();
  });

  it('sends nothing when the job was emailed before — a re-delivered job', async () => {
    execute.mockResolvedValue({ affected: 0 });

    const outcome = await service.sendDownloadLink('job-1');

    expect(outcome).toBe('already_sent');
    expect(createDownloadUrl).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(jobUpdate).not.toHaveBeenCalled();
  });

  it('sends nothing when the job is not completed — a failed job never emails a link', async () => {
    execute.mockResolvedValue({ affected: 0 });
    jobFindOne.mockResolvedValue({
      id: 'job-1',
      status: EpaPackJobStatus.FAILED,
      downloadEmailSentAt: null,
    });

    const outcome = await service.sendDownloadLink('job-1');

    expect(outcome).toBe('not_completed');
    expect(createDownloadUrl).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('releases the marker when the requester has portfolio emails switched off', async () => {
    sendEmail.mockResolvedValue('suppressed');

    const outcome = await service.sendDownloadLink('job-1');

    expect(outcome).toBe('suppressed');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(jobUpdate).toHaveBeenCalledWith('job-1', {
      downloadEmailSentAt: null,
    });
  });

  it('releases the marker when the requester has no email address', async () => {
    userFindOne.mockResolvedValue({
      id: 'user-1',
      email: '',
      firstName: 'Sam',
    });

    const outcome = await service.sendDownloadLink('job-1');

    expect(outcome).toBe('no_recipient');
    expect(createDownloadUrl).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(jobUpdate).toHaveBeenCalledWith('job-1', {
      downloadEmailSentAt: null,
    });
  });

  it('releases the marker and rethrows when presigning fails, so a retry can send', async () => {
    createDownloadUrl.mockRejectedValue(new Error('S3 unavailable'));

    await expect(service.sendDownloadLink('job-1')).rejects.toThrow(
      'S3 unavailable',
    );

    expect(sendEmail).not.toHaveBeenCalled();
    expect(jobUpdate).toHaveBeenCalledWith('job-1', {
      downloadEmailSentAt: null,
    });
  });
});
