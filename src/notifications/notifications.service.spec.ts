import { NotFoundException } from '@nestjs/common';
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
    notificationRepo.create.mockImplementation((x: Partial<Notification>) => x);
    notificationRepo.save.mockResolvedValue({
      id: 'n-new',
      userId: 'user-1',
      organisationId: null,
      type: NotificationType.SYSTEM,
      title: 'Welcome',
      body: 'Hi',
      readAt: null,
      metadata: null,
      createdAt,
      updatedAt: createdAt,
    });

    const result = await service.createForUser({
      userId: 'user-1',
      type: NotificationType.SYSTEM,
      title: 'Welcome',
      body: 'Hi',
    });

    expect(result.id).toBe('n-new');
    expect(notificationRepo.save).toHaveBeenCalled();
  });

  it('marks all notifications as read for user', async () => {
    qb.execute.mockResolvedValue({ affected: 3 });

    const result = await service.markAllRead('user-1');

    expect(result.updated).toBe(3);
    expect(qb.update).toHaveBeenCalled();
    expect(qb.execute).toHaveBeenCalled();
  });
});
