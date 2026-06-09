import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';

import { DasLevyTranche } from './entities/das-levy-tranche.entity.js';
import { LevyExpiryAlertDispatch } from './entities/levy-expiry-alert-dispatch.entity.js';
import { DasDonorLinkStatus } from './enums/das-donor-link-status.enum.js';
import { LevyExpiryAlertType } from './enums/levy-expiry-alert-type.enum.js';
import { LevyExpiryAlertService } from './services/levy-expiry-alert.service.js';

describe('LevyExpiryAlertService', () => {
  let service: LevyExpiryAlertService;

  const trancheFind = jest.fn();
  const dispatchFindOne = jest.fn();
  const dispatchCreate = jest.fn();
  const dispatchSave = jest.fn();
  const membershipFind = jest.fn();
  const createForUser = jest.fn();
  const enqueueEmail = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LevyExpiryAlertService,
        {
          provide: getRepositoryToken(DasLevyTranche),
          useValue: { find: trancheFind },
        },
        {
          provide: getRepositoryToken(LevyExpiryAlertDispatch),
          useValue: {
            findOne: dispatchFindOne,
            create: dispatchCreate,
            save: dispatchSave,
          },
        },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: { find: membershipFind },
        },
        {
          provide: NotificationsService,
          useValue: { createForUser },
        },
        {
          provide: EmailDispatchService,
          useValue: { enqueue: enqueueEmail },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              if (key === 'app.frontend.portalUrls.flow') {
                return 'https://flow.example.com';
              }
              if (key === 'app.email.appName') {
                return 'Graddly';
              }
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(LevyExpiryAlertService);
    jest.clearAllMocks();
  });

  function futureDateString(daysAhead: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysAhead);
    return date.toISOString().slice(0, 10);
  }

  it('sends alerts for due tranches and skips duplicates', async () => {
    const expiresOn90 = futureDateString(90);
    const expiresOn30 = futureDateString(30);

    trancheFind
      .mockResolvedValueOnce([
        {
          id: 'tranche-90',
          organisationId: 'org-1',
          donorLinkId: 'link-1',
          amount: '1000.00',
          expiresOn: expiresOn90,
          donorLink: {
            status: DasDonorLinkStatus.LINKED,
            label: 'HQ',
            ukprn: '12345678',
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'tranche-30',
          organisationId: 'org-1',
          donorLinkId: 'link-1',
          amount: '500.00',
          expiresOn: expiresOn30,
          donorLink: {
            status: DasDonorLinkStatus.LINKED,
            label: 'HQ',
            ukprn: '12345678',
          },
        },
      ]);

    dispatchFindOne.mockResolvedValue(null);
    dispatchCreate.mockImplementation(
      (value: LevyExpiryAlertDispatch) => value,
    );
    dispatchSave.mockImplementation((value: LevyExpiryAlertDispatch) =>
      Promise.resolve(value),
    );
    membershipFind.mockResolvedValue([
      {
        user: {
          id: 'admin-1',
          email: 'admin@example.com',
          firstName: 'Admin',
        },
      },
    ]);
    createForUser.mockResolvedValue(undefined);
    enqueueEmail.mockResolvedValue(undefined);

    const sent = await service.sendDueAlerts();
    expect(sent).toBe(2);
    expect(createForUser).toHaveBeenCalled();
    expect(enqueueEmail).toHaveBeenCalled();
  });

  it('skips already dispatched alerts', async () => {
    trancheFind.mockResolvedValue([
      {
        id: 'tranche-90',
        organisationId: 'org-1',
        donorLinkId: 'link-1',
        amount: '1000.00',
        expiresOn: futureDateString(90),
        donorLink: { status: DasDonorLinkStatus.LINKED, label: 'HQ' },
      },
    ]);
    dispatchFindOne.mockResolvedValue({
      id: 'dispatch-1',
      trancheId: 'tranche-90',
      alertType: LevyExpiryAlertType.DAYS_90,
    });

    const sent = await service.sendDueAlerts();
    expect(sent).toBe(0);
    expect(createForUser).not.toHaveBeenCalled();
  });

  it('skips tranches on unlinked donor accounts', async () => {
    trancheFind.mockResolvedValue([
      {
        id: 'tranche-90',
        organisationId: 'org-1',
        donorLinkId: 'link-1',
        amount: '1000.00',
        expiresOn: futureDateString(90),
        donorLink: { status: DasDonorLinkStatus.PENDING_CONSENT },
      },
    ]);

    const sent = await service.sendDueAlerts();
    expect(sent).toBe(0);
  });
});
