import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';

import { OtjLogEntry } from './entities/otj-log-entry.entity.js';
import { OtjLogStatus } from './enums/otj-log-status.enum.js';
import { OtjLogEntriesService } from './otj-log-entries.service.js';

describe('OtjLogEntriesService', () => {
  const repo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
    softRemove: jest.fn(),
  };
  const notificationsService = { createForUser: jest.fn() };
  const emailDispatchService = { enqueue: jest.fn() };
  const configService = { get: jest.fn() };
  const eifScoreCache = { invalidate: jest.fn() };

  let service: OtjLogEntriesService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OtjLogEntriesService,
        { provide: getRepositoryToken(OtjLogEntry), useValue: repo },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EmailDispatchService, useValue: emailDispatchService },
        { provide: ConfigService, useValue: configService },
        { provide: EifScoreCacheService, useValue: eifScoreCache },
      ],
    }).compile();

    service = moduleRef.get(OtjLogEntriesService);
    jest.clearAllMocks();
  });

  const user = {
    id: 'u-1',
    email: 'user@example.com',
    firstName: 'Ada',
    organisationId: 'org-1',
  } as const;

  it('creates OTJ entry in draft status', async () => {
    repo.create.mockImplementation((v: unknown) => v);
    repo.save.mockImplementation((v: unknown) => Promise.resolve(v));
    const created = await service.create(user, {
      enrolmentId: 'e-1',
      apprenticeId: 'a-1',
      loggedDate: '2026-01-01',
      minutes: 60,
    });
    expect(created.status).toBe(OtjLogStatus.DRAFT);
  });

  it('throws not found on missing item', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne(user, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects invalid bulk transition', async () => {
    repo.findOne.mockResolvedValue({
      id: 'id-1',
      organisationId: 'org-1',
      status: OtjLogStatus.DRAFT,
    });
    const out = await service.bulkApprove(user, ['id-1']);
    expect(out.failed).toBe(1);
    expect(out.results[0].reasonCode).toBe('invalid_transition');
  });

  it('submits draft entry via status update', async () => {
    repo.findOne.mockResolvedValue({
      id: 'id-1',
      organisationId: 'org-1',
      status: OtjLogStatus.DRAFT,
      minutes: 60,
    });
    repo.save.mockImplementation((v: unknown) => Promise.resolve(v));

    const updated = await service.update(user, 'id-1', {
      status: OtjLogStatus.SUBMITTED,
    });
    expect(updated.status).toBe(OtjLogStatus.SUBMITTED);
  });

  it('bulk approves submitted entries', async () => {
    repo.findOne.mockResolvedValue({
      id: 'id-1',
      organisationId: 'org-1',
      status: OtjLogStatus.SUBMITTED,
    });
    repo.save.mockImplementation((v: unknown) => Promise.resolve(v));
    notificationsService.createForUser.mockResolvedValue(undefined);
    emailDispatchService.enqueue.mockResolvedValue(undefined);
    const out = await service.bulkApprove(user, ['id-1']);
    expect(out.succeeded).toBe(1);
  });
});
