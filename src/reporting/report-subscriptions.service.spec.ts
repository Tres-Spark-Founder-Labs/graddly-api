import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { User } from '../users/entities/user.entity.js';

import { ReportSubscription } from './entities/report-subscription.entity.js';
import { ReportSubscriptionsService } from './report-subscriptions.service.js';

describe('ReportSubscriptionsService (F1.4.1 AC5)', () => {
  const subscriptionRepo = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((v: unknown) => v),
    createQueryBuilder: jest.fn(),
  };
  const membershipRepo = { find: jest.fn() };
  const userRepo = { findBy: jest.fn() };

  let service: ReportSubscriptionsService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportSubscriptionsService,
        {
          provide: getRepositoryToken(ReportSubscription),
          useValue: subscriptionRepo,
        },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: membershipRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = moduleRef.get(ReportSubscriptionsService);
    jest.clearAllMocks();
    subscriptionRepo.find.mockResolvedValue([]);
    subscriptionRepo.save.mockImplementation((v: unknown) =>
      Promise.resolve(v),
    );
    userRepo.findBy.mockResolvedValue([]);
    membershipRepo.find.mockResolvedValue([]);
  });

  /**
   * The report carries apprentice counts, completion and withdrawal rates and
   * levy spend. Emailing it to an address somebody typed into a box is a
   * data-protection incident waiting for a typo — decision 5 settled the same
   * question for the OTJ digest.
   */
  it('refuses recipients who are not active members', async () => {
    membershipRepo.find.mockResolvedValue([{ user: { id: 'u-1' } }]);

    await expect(
      service.replace('org-1', ['u-1', 'u-outsider'], 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subscriptionRepo.save).not.toHaveBeenCalled();
  });

  it('creates subscriptions for members not already on the list', async () => {
    membershipRepo.find.mockResolvedValue([
      { user: { id: 'u-1' } },
      { user: { id: 'u-2' } },
    ]);

    await service.replace('org-1', ['u-1', 'u-2'], 'admin-1');

    const saved = subscriptionRepo.save.mock.calls as [
      Array<{ userId: string; addedByUserId: string }>,
    ][];
    const created = saved[0][0];
    expect(created.map((c) => c.userId).sort()).toEqual(['u-1', 'u-2']);
    expect(created[0].addedByUserId).toBe('admin-1');
  });

  /**
   * Disabled, not deleted: "when did this person last receive the board
   * report" is a question that outlives their place on the list.
   */
  it('disables a removed recipient rather than deleting the row', async () => {
    const existing = {
      id: 's-1',
      userId: 'u-1',
      enabled: true,
      lastSentAt: new Date('2026-06-01T07:00:00Z'),
    };
    subscriptionRepo.find.mockResolvedValue([existing]);

    await service.replace('org-1', [], 'admin-1');

    expect(existing.enabled).toBe(false);
    expect(existing.lastSentAt).toEqual(new Date('2026-06-01T07:00:00Z'));
    expect(subscriptionRepo.save).toHaveBeenCalledWith(existing);
  });

  it('re-enables somebody who was removed and put back', async () => {
    const existing = { id: 's-1', userId: 'u-1', enabled: false };
    subscriptionRepo.find.mockResolvedValue([existing]);
    membershipRepo.find.mockResolvedValue([{ user: { id: 'u-1' } }]);

    await service.replace('org-1', ['u-1'], 'admin-1');

    expect(existing.enabled).toBe(true);
    // Re-enabled, not duplicated — the partial unique index would reject a
    // second live row for the same user.
    const saved = subscriptionRepo.save.mock.calls as [unknown][];
    const createCalls = saved.filter((call) => Array.isArray(call[0]));
    expect(createCalls).toHaveLength(0);
  });

  it('de-duplicates a list containing the same user twice', async () => {
    membershipRepo.find.mockResolvedValue([{ user: { id: 'u-1' } }]);

    await service.replace('org-1', ['u-1', 'u-1'], 'admin-1');

    const saved = subscriptionRepo.save.mock.calls as [unknown[]][];
    const created = saved[0][0];
    expect(created).toHaveLength(1);
  });

  it('allows an empty list, which stops delivery', async () => {
    await expect(service.replace('org-1', [], 'admin-1')).resolves.toEqual([]);
    expect(membershipRepo.find).not.toHaveBeenCalled();
  });

  it('drops subscriptions whose user record has gone', async () => {
    subscriptionRepo.find.mockResolvedValue([
      { id: 's-1', userId: 'u-1', lastSentAt: null },
      { id: 's-2', userId: 'u-missing', lastSentAt: null },
    ]);
    userRepo.findBy.mockResolvedValue([
      { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace', email: 'a@b.com' },
    ]);

    const result = await service.list('org-1');

    expect(result).toEqual([
      {
        userId: 'u-1',
        name: 'Ada Lovelace',
        email: 'a@b.com',
        lastSentAt: null,
      },
    ]);
  });
});
