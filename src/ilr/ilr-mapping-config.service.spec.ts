import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import { IlrMappingConfig } from './entities/ilr-mapping-config.entity.js';
import { IlrMappingConfigStatus } from './enums/ilr-mapping-config-status.enum.js';
import { IlrMappingConfigService } from './ilr-mapping-config.service.js';
import { minimalMappingConfig } from './testing/ilr-test-fixtures.js';

describe('IlrMappingConfigService', () => {
  let service: IlrMappingConfigService;
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((input: unknown) => input),
    save: jest.fn((input: IlrMappingConfig) =>
      Promise.resolve({
        ...input,
        id: input.id ?? 'cfg-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        isDeleted: false,
      }),
    ),
  };

  const adminUser = {
    id: 'user-1',
    roles: [OrganisationRole.ADMIN],
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IlrMappingConfigService,
        {
          provide: getRepositoryToken(IlrMappingConfig),
          useValue: repo,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              if (key === 'app.ilr.configWriteEnabled') {
                return true;
              }
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(IlrMappingConfigService);
    jest.clearAllMocks();
  });

  it('returns active published config', async () => {
    repo.findOne.mockResolvedValue({
      id: 'cfg-1',
      academicYear: '2025-26',
      version: 1,
      status: IlrMappingConfigStatus.PUBLISHED,
      config: minimalMappingConfig,
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.findActivePublished('2025-26');
    expect(result.version).toBe(1);
    expect(result.status).toBe(IlrMappingConfigStatus.PUBLISHED);
  });

  it('throws when active published config missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findActivePublished('2099-00')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('publishes draft and supersedes prior published config', async () => {
    const draft = {
      id: 'cfg-2',
      academicYear: '2025-26',
      version: 2,
      status: IlrMappingConfigStatus.DRAFT,
      config: minimalMappingConfig,
      publishedAt: null,
    };
    const published = {
      id: 'cfg-1',
      academicYear: '2025-26',
      version: 1,
      status: IlrMappingConfigStatus.PUBLISHED,
      config: minimalMappingConfig,
      publishedAt: new Date(),
    };

    repo.findOne.mockResolvedValueOnce(draft).mockResolvedValueOnce(published);

    const result = await service.publish(adminUser as never, 'cfg-2');
    expect(result.status).toBe(IlrMappingConfigStatus.PUBLISHED);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: IlrMappingConfigStatus.SUPERSEDED }),
    );
  });

  it('lists all mapping configs', async () => {
    repo.find.mockResolvedValue([
      {
        id: 'cfg-1',
        academicYear: '2025-26',
        version: 1,
        status: IlrMappingConfigStatus.PUBLISHED,
        config: minimalMappingConfig,
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await service.findAll();

    expect(result).toHaveLength(1);
    expect(result[0].academicYear).toBe('2025-26');
  });

  it('returns active published entity', async () => {
    const entity = {
      id: 'cfg-1',
      academicYear: '2025-26',
      version: 1,
      status: IlrMappingConfigStatus.PUBLISHED,
      config: minimalMappingConfig,
    };
    repo.findOne.mockResolvedValue(entity);

    await expect(service.getActivePublishedEntity('2025-26')).resolves.toEqual(
      entity,
    );
  });

  it('creates draft config with next version', async () => {
    repo.findOne.mockResolvedValue({
      id: 'cfg-1',
      academicYear: '2025-26',
      version: 1,
    });

    const result = await service.createDraft(adminUser as never, {
      academicYear: '2025-26',
      config: minimalMappingConfig,
    });

    expect(result.version).toBe(2);
    expect(result.status).toBe(IlrMappingConfigStatus.DRAFT);
  });

  it('rejects publish when config is not draft', async () => {
    repo.findOne.mockResolvedValue({
      id: 'cfg-1',
      status: IlrMappingConfigStatus.PUBLISHED,
    });

    await expect(service.publish(adminUser as never, 'cfg-1')).rejects.toThrow(
      BadRequestException,
    );
  });
});
