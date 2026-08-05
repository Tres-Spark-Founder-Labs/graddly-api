import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailDispatchService } from '../../email/email-dispatch.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { OrganisationMembership } from '../../organisations/entities/organisation-membership.entity.js';
import { DasLevyTranche } from '../entities/das-levy-tranche.entity.js';
import { LevyExpiryAlertDispatch } from '../entities/levy-expiry-alert-dispatch.entity.js';
import { DasDonorLinkStatus } from '../enums/das-donor-link-status.enum.js';

import { LevyExpiryAlertService } from './levy-expiry-alert.service.js';

/**
 * Security hardening pass, item 7.
 *
 * This service had no spec at all, which is part of why both of its bugs
 * survived: a cross-tenant read with no context, and a dispatch row written
 * whether or not the alert reached anyone.
 */
describe('LevyExpiryAlertService', () => {
  const trancheRepo = { find: jest.fn() };
  const dispatchRepo = {
    findOne: jest.fn(),
    create: jest.fn((v: unknown) => v),
    save: jest.fn(),
  };
  const membershipRepo = { find: jest.fn() };
  const notificationsService = { createForUser: jest.fn() };
  const emailDispatchService = { enqueue: jest.fn() };
  const configGet = jest.fn(
    (_key: string, fallback?: unknown) => fallback ?? 'Graddly',
  );

  let service: LevyExpiryAlertService;

  const tranche = {
    id: 'tr-1',
    organisationId: 'org-1',
    donorLinkId: 'dl-1',
    amount: '10000.00',
    expiresOn: '2026-11-01',
    donorLink: { status: DasDonorLinkStatus.LINKED, label: 'Acme DAS' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    dispatchRepo.findOne.mockResolvedValue(null);
    /**
     * `sendDueAlerts` runs two windows (90 days and 30 days). A real tranche
     * has one expiry date and therefore matches exactly one of them, so the
     * mock returns it on the first window only.
     *
     * An earlier version of this mock returned it for both and made `sent` 2 —
     * which would have been testing the mock rather than the service.
     */
    let windowCall = 0;
    trancheRepo.find.mockImplementation(() => {
      windowCall += 1;
      return Promise.resolve(windowCall === 1 ? [tranche] : []);
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyExpiryAlertService,
        { provide: getRepositoryToken(DasLevyTranche), useValue: trancheRepo },
        {
          provide: getRepositoryToken(LevyExpiryAlertDispatch),
          useValue: dispatchRepo,
        },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: membershipRepo,
        },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EmailDispatchService, useValue: emailDispatchService },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = moduleRef.get(LevyExpiryAlertService);
  });

  /**
   * The write-before-confirm bug.
   *
   * `notifyOrganisation` returned void and simply looped over its recipients,
   * so an empty recipient list was indistinguishable from a delivered alert.
   * The dispatch row was written anyway — and that row is the "already
   * alerted?" guard, so the tranche was **permanently excluded from
   * alerting**, right up to the day the funds expired.
   *
   * Levy funds expire 24 months after they are paid in, so this was money the
   * employer silently lost.
   */
  it('does not record a dispatch when no recipient can be resolved', async () => {
    membershipRepo.find.mockResolvedValue([]);

    const sent = await service.sendDueAlerts();

    expect(sent).toBe(0);
    expect(dispatchRepo.save).not.toHaveBeenCalled();
    expect(notificationsService.createForUser).not.toHaveBeenCalled();
  });

  /** A membership row whose user relation is missing is equally undelivered. */
  it('does not record a dispatch when the recipient has no user record', async () => {
    membershipRepo.find.mockResolvedValue([{ id: 'm-1', user: null }]);

    await service.sendDueAlerts();

    expect(dispatchRepo.save).not.toHaveBeenCalled();
  });

  it('records a dispatch once the alert actually reaches someone', async () => {
    membershipRepo.find.mockResolvedValue([
      { id: 'm-1', user: { id: 'u-1', firstName: 'Sam', email: 's@x.com' } },
    ]);

    const sent = await service.sendDueAlerts();

    expect(sent).toBe(1);
    expect(notificationsService.createForUser).toHaveBeenCalledTimes(1);
    expect(dispatchRepo.save).toHaveBeenCalledTimes(1);
  });

  /**
   * A tranche whose donor link is no longer connected is skipped before any
   * delivery is attempted — so it must not be recorded as alerted either.
   */
  it('skips tranches whose donor link is not connected', async () => {
    trancheRepo.find.mockResolvedValue([
      { ...tranche, donorLink: { status: DasDonorLinkStatus.PENDING_CONSENT } },
    ]);
    membershipRepo.find.mockResolvedValue([
      { id: 'm-1', user: { id: 'u-1', firstName: 'Sam', email: 's@x.com' } },
    ]);

    const sent = await service.sendDueAlerts();

    expect(sent).toBe(0);
    expect(dispatchRepo.save).not.toHaveBeenCalled();
  });
});
