import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EifScoreCacheService } from '../ofsted/eif-score-cache.service.js';
import { StorageKeyBuilder } from '../storage/storage-key.builder.js';

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
  const enrolmentRepo = { findOne: jest.fn() };
  const keyBuilder = { belongsToOrganisation: jest.fn().mockReturnValue(true) };

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
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: StorageKeyBuilder, useValue: keyBuilder },
      ],
    }).compile();

    service = moduleRef.get(OtjLogEntriesService);
    jest.clearAllMocks();
    enrolmentRepo.findOne.mockResolvedValue({
      id: 'e-1',
      organisationId: 'org-1',
      apprenticeId: 'a-1',
    });
    keyBuilder.belongsToOrganisation.mockReturnValue(true);
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

  it('rejects create when enrolment is missing', async () => {
    enrolmentRepo.findOne.mockResolvedValue(null);
    await expect(
      service.create(user, {
        enrolmentId: 'e-1',
        apprenticeId: 'a-1',
        loggedDate: '2026-01-01',
        minutes: 60,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects evidence keys that do not match apprentice path', async () => {
    await expect(
      service.create(user, {
        enrolmentId: 'e-1',
        apprenticeId: 'a-1',
        loggedDate: '2026-01-01',
        minutes: 60,
        evidence: {
          files: ['orgs/org-1/learners/wrong-apprentice/evidence/x/file.jpg'],
        },
      }),
    ).rejects.toThrow(
      'Storage key must be an evidence object for this apprentice',
    );
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
