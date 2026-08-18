import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Notification } from './entities/notification.entity.js';
import { NotificationType } from './enums/notification-type.enum.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };

  const notificationRepo = {
    createQueryBuilder: jest.fn(() => qb),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    manager: { query: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(Notification),
          useValue: notificationRepo,
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  it('lists notifications for a user', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    qb.getManyAndCount.mockResolvedValue([
      [
        {
          id: 'n-1',
          userId: 'user-1',
          organisationId: null,
          type: NotificationType.SYSTEM,
          title: 'Hello',
          body: 'World',
          readAt: null,
          metadata: null,
          createdAt,
          updatedAt: createdAt,
        },
      ],
      1,
    ]);

    const result = await service.listForUser('user-1', {
      page: 1,
      perPage: 20,
    });

    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(qb.andWhere).not.toHaveBeenCalledWith('n.readAt IS NULL');
  });

  it('marks a notification as read', async () => {
    const notification = {
      id: 'n-1',
      userId: 'user-1',
      organisationId: null,
      type: NotificationType.GENERIC,
      title: 'T',
      body: 'B',
      readAt: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    notificationRepo.findOne.mockResolvedValue(notification);
    notificationRepo.save.mockImplementation((n: Notification) =>
      Promise.resolve(n),
    );

    const result = await service.markRead('user-1', 'n-1');

    expect(result.readAt).toBeInstanceOf(Date);
    expect(notificationRepo.save).toHaveBeenCalled();
  });

  it('throws when notification is missing', async () => {
    notificationRepo.findOne.mockResolvedValue(null);

    await expect(service.markRead('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('creates notifications for a user', async () => {
    const createdAt = new Date();
    notificationRepo.manager.query.mockResolvedValue([
      {
        id: 'n-new',
        userId: 'user-1',
        organisationId: 'org-1',
        type: NotificationType.SYSTEM,
        title: 'Welcome',
        body: 'Hi',
        readAt: null,
        metadata: null,
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const result = await service.createForUser({
      userId: 'user-1',
      organisationId: 'org-1',
      type: NotificationType.SYSTEM,
      title: 'Welcome',
      body: 'Hi',
    });

    expect(result?.id).toBe('n-new');

    /**
     * Written through `app_create_notification`, not `repo.save()`. TypeORM
     * appends `RETURNING` to its INSERT, which is a *read* of the new row and
     * is therefore judged by the SELECT policy — and the actor is never the
     * recipient. Asserting `save` was not called keeps that from regressing
     * quietly. See migration 1781100000052 and OQ-16.
     */
    expect(notificationRepo.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('app_create_notification'),
      expect.arrayContaining(['user-1', 'org-1']),
    );
    expect(notificationRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a notification carrying no organisationId', async () => {
    // The RLS policy is keyed on organisationId, so an absent value produces a
    // NULL comparison, the WITH CHECK fails closed, and the caller gets an
    // opaque 42501. Failing here names the problem at the call site instead.
    await expect(
      service.createForUser({
        userId: 'user-1',
        type: NotificationType.SYSTEM,
        title: 'Welcome',
        body: 'Hi',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(notificationRepo.manager.query).not.toHaveBeenCalled();
  });

  it('returns null when the recipient is not yet an organisation member', async () => {
    /**
     * PRD F1.2.5 AC5 tracks *invited* and *account created* as states in their
     * own right, both preceding membership, so a recipient who cannot yet
     * receive anything is a normal point in the journey rather than a fault.
     * Callers that ignore the result skip quietly.
     */
    notificationRepo.manager.query.mockRejectedValue(
      Object.assign(
        new Error(
          'app_create_notification: recipient u-1 is not an active member of organisation org-1',
        ),
        { code: '42501' },
      ),
    );

    const result = await service.createForUser({
      userId: 'user-1',
      organisationId: 'org-1',
      type: NotificationType.SYSTEM,
      title: 'Welcome',
      body: 'Hi',
    });

    expect(result).toBeNull();
  });

  it('rethrows a genuine row-level-security violation', async () => {
    // Same SQLSTATE as the case above, different meaning — which is why the
    // service matches on the message too. Treating every 42501 as benign would
    // re-hide exactly the class of defect this path exists to surface.
    notificationRepo.manager.query.mockRejectedValue(
      Object.assign(
        new Error(
          'new row violates row-level security policy for table "notifications"',
        ),
        { code: '42501' },
      ),
    );

    await expect(
      service.createForUser({
        userId: 'user-1',
        organisationId: 'org-1',
        type: NotificationType.SYSTEM,
        title: 'Welcome',
        body: 'Hi',
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('marks all notifications as read for user', async () => {
    qb.execute.mockResolvedValue({ affected: 3 });

    const result = await service.markAllRead('user-1');

    expect(result.updated).toBe(3);
    expect(qb.update).toHaveBeenCalled();
    expect(qb.execute).toHaveBeenCalled();
  });
});
