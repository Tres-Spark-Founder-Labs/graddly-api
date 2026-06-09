import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DasHttpClient } from '../das/das-http.client.js';

import { DasDonorLink } from './entities/das-donor-link.entity.js';
import { DasDonorOAuthToken } from './entities/das-donor-oauth-token.entity.js';
import { DasDonorLinkStatus } from './enums/das-donor-link-status.enum.js';
import { DasDonorLinkService } from './services/das-donor-link.service.js';
import { DasDonorOAuthService } from './services/das-donor-oauth.service.js';
import { DasDonorSyncService } from './services/das-donor-sync.service.js';

describe('DasDonorLinkService', () => {
  let service: DasDonorLinkService;

  const fetchLevyBalance = jest.fn();
  const refreshToken = jest.fn();
  const encryptTokenPayload = jest.fn();
  const replaceTranches = jest.fn();
  const isConfigured = jest.fn();
  const buildAuthorizeUrl = jest.fn();
  const verifyState = jest.fn();
  const exchangeCode = jest.fn();

  const linkFindOne = jest.fn();
  const linkFind = jest.fn();
  const linkCreate = jest.fn();
  const linkSave = jest.fn();
  const linkSoftRemove = jest.fn();

  const tokenFindOne = jest.fn();
  const tokenCreate = jest.fn();
  const tokenSave = jest.fn();
  const tokenSoftRemove = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DasDonorLinkService,
        {
          provide: DasHttpClient,
          useValue: { fetchLevyBalance },
        },
        {
          provide: DasDonorOAuthService,
          useValue: {
            isConfigured,
            buildAuthorizeUrl,
            refreshToken,
            encryptTokenPayload,
            verifyState,
            exchangeCode,
          },
        },
        {
          provide: DasDonorSyncService,
          useValue: { replaceTranches },
        },
        {
          provide: getRepositoryToken(DasDonorLink),
          useValue: {
            findOne: linkFindOne,
            find: linkFind,
            create: linkCreate,
            save: linkSave,
            softRemove: linkSoftRemove,
          },
        },
        {
          provide: getRepositoryToken(DasDonorOAuthToken),
          useValue: {
            findOne: tokenFindOne,
            create: tokenCreate,
            save: tokenSave,
            softRemove: tokenSoftRemove,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(DasDonorLinkService);
    jest.clearAllMocks();
  });

  it('creates a pending donor link', async () => {
    linkCreate.mockImplementation((value: DasDonorLink) => value);
    linkSave.mockImplementation((value: DasDonorLink) =>
      Promise.resolve({
        ...value,
        id: 'link-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );

    const result = await service.create('org-1', {
      label: 'Group Ltd',
      ukprn: '12345678',
    });

    expect(result.status).toBe(DasDonorLinkStatus.PENDING_CONSENT);
    expect(result.label).toBe('Group Ltd');
    expect(result.ukprn).toBe('12345678');
  });

  it('throws not found when donor link missing', async () => {
    linkFindOne.mockResolvedValue(null);
    await expect(service.findOne('org-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('syncs linked donor balance and replaces tranches', async () => {
    const link: DasDonorLink = {
      id: 'link-1',
      organisationId: 'org-1',
      label: null,
      dasAccountId: null,
      ukprn: '12345678',
      status: DasDonorLinkStatus.LINKED,
      lastErrorMessage: null,
      consentedAt: new Date(),
      lastSyncedAt: null,
      lastBalance: null,
      lastRawPayload: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      isDeleted: false,
      deletedAt: null,
    };

    linkFindOne.mockResolvedValue(link);
    tokenFindOne.mockResolvedValue({
      id: 'token-1',
      donorLinkId: 'link-1',
      organisationId: 'org-1',
      accessTokenEncrypted: 'enc-access',
      refreshTokenEncrypted: 'enc-refresh',
      expiresAt: new Date(Date.now() + 60_000),
      scope: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      isDeleted: false,
      deletedAt: null,
    });
    refreshToken.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() + 3_600_000),
      scope: 'levy.read',
    });
    encryptTokenPayload.mockReturnValue({
      accessTokenEncrypted: 'enc-access',
      refreshTokenEncrypted: 'enc-refresh',
      expiresAt: new Date(Date.now() + 3_600_000),
      scope: 'levy.read',
    });
    tokenSave.mockImplementation((value: DasDonorOAuthToken) =>
      Promise.resolve(value),
    );
    fetchLevyBalance.mockResolvedValue({
      accountId: 'das-1',
      balance: '2500.00',
      currency: 'GBP',
      raw: { tranches: [{ amount: 1000, expiresOn: '2027-01-01' }] },
    });
    linkSave.mockImplementation((value: DasDonorLink) =>
      Promise.resolve(value),
    );
    replaceTranches.mockResolvedValue([]);

    const result = await service.syncDonorLink('org-1', 'link-1');

    expect(fetchLevyBalance).toHaveBeenCalledWith('12345678', 'access-token');
    expect(replaceTranches).toHaveBeenCalledWith('link-1', 'org-1', {
      tranches: [{ amount: 1000, expiresOn: '2027-01-01' }],
    });
    expect(result.lastBalance).toBe('2500.00');
    expect(result.dasAccountId).toBe('das-1');
  });

  it('rejects sync when donor link is not connected', async () => {
    linkFindOne.mockResolvedValue({
      id: 'link-1',
      organisationId: 'org-1',
      ukprn: '12345678',
      status: DasDonorLinkStatus.PENDING_CONSENT,
    });

    await expect(
      service.syncDonorLink('org-1', 'link-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists donor links for organisation', async () => {
    linkFind.mockResolvedValue([
      {
        id: 'link-1',
        organisationId: 'org-1',
        label: 'HQ',
        dasAccountId: null,
        ukprn: '12345678',
        status: DasDonorLinkStatus.PENDING_CONSENT,
        lastErrorMessage: null,
        consentedAt: null,
        lastSyncedAt: null,
        lastBalance: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    ]);

    const result = await service.findAll('org-1');
    expect(result).toHaveLength(1);
    expect(result[0]?.label).toBe('HQ');
  });

  it('removes donor link and token', async () => {
    linkFindOne.mockResolvedValue({
      id: 'link-1',
      organisationId: 'org-1',
      status: DasDonorLinkStatus.LINKED,
    });
    tokenFindOne.mockResolvedValue({ id: 'token-1' });
    tokenSoftRemove.mockResolvedValue(undefined);
    linkSoftRemove.mockResolvedValue(undefined);

    await service.remove('org-1', 'link-1');
    expect(tokenSoftRemove).toHaveBeenCalled();
    expect(linkSoftRemove).toHaveBeenCalled();
  });

  it('starts consent when OAuth is configured', async () => {
    isConfigured.mockReturnValue(true);
    linkFindOne.mockResolvedValue({
      id: 'link-1',
      organisationId: 'org-1',
      status: DasDonorLinkStatus.PENDING_CONSENT,
    });
    buildAuthorizeUrl.mockReturnValue('https://das.example.com/oauth');

    const result = await service.startConsent('org-1', 'user-1', 'link-1');
    expect(result.authorizeUrl).toBe('https://das.example.com/oauth');
  });

  it('rejects consent start when OAuth is not configured', async () => {
    isConfigured.mockReturnValue(false);
    linkFindOne.mockResolvedValue({
      id: 'link-1',
      organisationId: 'org-1',
      status: DasDonorLinkStatus.PENDING_CONSENT,
    });

    await expect(
      service.startConsent('org-1', 'user-1', 'link-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('completes OAuth callback and links donor account', async () => {
    verifyState.mockReturnValue({
      linkId: 'link-1',
      orgId: 'org-1',
      userId: 'user-1',
    });
    linkFindOne.mockResolvedValue({
      id: 'link-1',
      organisationId: 'org-1',
      label: 'HQ',
      status: DasDonorLinkStatus.PENDING_CONSENT,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
    exchangeCode.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: new Date(Date.now() + 3600_000),
      scope: 'levy.read',
    });
    encryptTokenPayload.mockReturnValue({
      accessTokenEncrypted: 'enc-access',
      refreshTokenEncrypted: 'enc-refresh',
      expiresAt: new Date(Date.now() + 3600_000),
      scope: 'levy.read',
    });
    tokenFindOne.mockResolvedValue(null);
    tokenCreate.mockImplementation((value: DasDonorOAuthToken) => value);
    tokenSave.mockImplementation((value: DasDonorOAuthToken) =>
      Promise.resolve(value),
    );
    linkSave.mockImplementation((value: DasDonorLink) =>
      Promise.resolve({
        ...value,
        status: DasDonorLinkStatus.LINKED,
        consentedAt: new Date('2026-01-02'),
      }),
    );

    const result = await service.completeOAuthCallback('code', 'state');
    expect(result.status).toBe(DasDonorLinkStatus.LINKED);
    expect(exchangeCode).toHaveBeenCalledWith('code');
  });
});
