import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  getRlsBootstrap,
  runWithCorrelationId,
} from '../common/context/correlation-id-context.js';

import { PushSubscription } from './entities/push-subscription.entity.js';
import { PushNotificationsService } from './push-notifications.service.js';
import { WebPushClient } from './web-push.client.js';

/**
 * F3.4.3 AC4 — delivery to a recipient's browsers. The `web-push` library is
 * behind WebPushClient, doubled here; what these pin is what the service does
 * with each answer, and that it reads the recipient's rows past row-level
 * security.
 */
describe('PushNotificationsService', () => {
  const subscriptionRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const client = {
    isEnabled: jest.fn(),
    publicKey: jest.fn(),
    send: jest.fn(),
  };

  let service: PushNotificationsService;

  const rows = () => [
    {
      id: 's-phone',
      endpoint: 'https://push.example/phone',
      p256dh: 'k1',
      auth: 'a1',
    },
    {
      id: 's-laptop',
      endpoint: 'https://push.example/laptop',
      p256dh: 'k2',
      auth: 'a2',
    },
  ];
  const payload = {
    title: 'No off-the-job hours logged this week',
    body: 'Log a session now.',
    url: '/otj-logs?log=1',
    tag: 'otj-inactivity',
  };
  const webPushError = (statusCode: number) =>
    Object.assign(new Error(`push service said ${statusCode}`), { statusCode });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushNotificationsService,
        {
          provide: getRepositoryToken(PushSubscription),
          useValue: subscriptionRepo,
        },
        { provide: WebPushClient, useValue: client },
      ],
    }).compile();
    service = moduleRef.get(PushNotificationsService);
    jest.clearAllMocks();
    client.isEnabled.mockReturnValue(true);
    subscriptionRepo.update.mockResolvedValue(undefined);
  });

  describe('sendToUser', () => {
    it('pushes the payload to every live subscription of the recipient', async () => {
      subscriptionRepo.find.mockResolvedValue(rows());
      client.send.mockResolvedValue({ statusCode: 201 });

      const outcome = await service.sendToUser('user-1', payload);

      expect(outcome).toEqual({ delivered: 2, expired: 0, failed: 0 });
      expect(client.send).toHaveBeenCalledTimes(2);
      const [subscription, body] = client.send.mock.calls[0] as [
        { endpoint: string; keys: { p256dh: string; auth: string } },
        string,
      ];
      expect(subscription).toEqual({
        endpoint: 'https://push.example/phone',
        keys: { p256dh: 'k1', auth: 'a1' },
      });
      expect(JSON.parse(body)).toEqual(payload);
    });

    it('deletes a subscription the push service says is gone (410), and keeps the rest', async () => {
      subscriptionRepo.find.mockResolvedValue(rows());
      client.send
        .mockRejectedValueOnce(webPushError(410))
        .mockResolvedValueOnce({ statusCode: 201 });

      const outcome = await service.sendToUser('user-1', payload);

      expect(outcome).toEqual({ delivered: 1, expired: 1, failed: 0 });
      expect(subscriptionRepo.update).toHaveBeenCalledTimes(1);
      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        's-phone',
        expect.objectContaining({ isDeleted: true }),
      );
    });

    it('deletes on 404 as well', async () => {
      subscriptionRepo.find.mockResolvedValue([rows()[0]]);
      client.send.mockRejectedValueOnce(webPushError(404));

      await expect(service.sendToUser('user-1', payload)).resolves.toEqual({
        delivered: 0,
        expired: 1,
        failed: 0,
      });
      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        's-phone',
        expect.objectContaining({ isDeleted: true }),
      );
    });

    it('keeps a subscription that failed for any other reason', async () => {
      // A push service can be briefly unavailable; that is not "gone".
      subscriptionRepo.find.mockResolvedValue([rows()[0]]);
      client.send.mockRejectedValueOnce(webPushError(503));

      await expect(service.sendToUser('user-1', payload)).resolves.toEqual({
        delivered: 0,
        expired: 0,
        failed: 1,
      });
      expect(subscriptionRepo.update).not.toHaveBeenCalled();
    });

    it('sends nothing, and reads nothing, when web push is not configured', async () => {
      client.isEnabled.mockReturnValue(false);

      await expect(service.sendToUser('user-1', payload)).resolves.toEqual({
        delivered: 0,
        expired: 0,
        failed: 0,
      });
      expect(subscriptionRepo.find).not.toHaveBeenCalled();
    });

    /**
     * The recipient is almost never the actor, and push_subscriptions_select
     * admits only a row's own user. Read as the actor, the rows are invisible
     * and nobody is ever pushed. The read must happen with the flag on, and
     * the window must close after.
     */
    it("reads the recipient's subscriptions past row-level security, and closes the window", async () => {
      const flagDuringRead: boolean[] = [];
      subscriptionRepo.find.mockImplementation(() => {
        flagDuringRead.push(getRlsBootstrap());
        return Promise.resolve(rows());
      });
      client.send.mockResolvedValue({ statusCode: 201 });

      await runWithCorrelationId('push-spec', async () => {
        await service.sendToUser('user-1', payload);
        expect(getRlsBootstrap()).toBe(false);
      });

      expect(flagDuringRead).toEqual([true]);
      const [options] = subscriptionRepo.find.mock.calls[0] as [
        { where: Record<string, unknown>; select: string[] },
      ];
      expect(options.where).toMatchObject({
        user: { id: 'user-1' },
        isDeleted: false,
      });
      expect(options.select).toEqual(['id', 'endpoint', 'p256dh', 'auth']);
    });
  });

  describe('subscribe', () => {
    it('updates the same browser rather than adding a second row for its endpoint', async () => {
      const existing = {
        id: 's-1',
        userId: 'user-1',
        endpoint: 'https://push.example/phone',
        p256dh: 'old',
        auth: 'old',
        userAgent: null,
      };
      subscriptionRepo.findOne.mockResolvedValue(existing);
      subscriptionRepo.save.mockImplementation((row: unknown) =>
        Promise.resolve(row),
      );

      const saved = await service.subscribe('user-1', {
        endpoint: 'https://push.example/phone',
        p256dh: 'new',
        auth: 'new',
        userAgent: 'Mobile Safari',
      });

      expect(saved).toMatchObject({ id: 's-1', p256dh: 'new', auth: 'new' });
      expect(subscriptionRepo.create).not.toHaveBeenCalled();
    });

    it("retires another account's row for the same browser before storing this one", async () => {
      subscriptionRepo.findOne.mockResolvedValue({
        id: 's-old',
        userId: 'user-other',
        endpoint: 'https://push.example/phone',
      });
      subscriptionRepo.create.mockImplementation((row: unknown) => row);
      subscriptionRepo.save.mockImplementation((row: unknown) =>
        Promise.resolve(row),
      );

      await service.subscribe('user-1', {
        endpoint: 'https://push.example/phone',
        p256dh: 'k',
        auth: 'a',
        userAgent: null,
      });

      const [retired] = subscriptionRepo.save.mock.calls[0] as [
        { id: string; isDeleted: boolean },
      ];
      expect(retired).toMatchObject({ id: 's-old', isDeleted: true });
      expect(subscriptionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user: { id: 'user-1' },
          endpoint: 'https://push.example/phone',
        }),
      );
    });
  });
});
