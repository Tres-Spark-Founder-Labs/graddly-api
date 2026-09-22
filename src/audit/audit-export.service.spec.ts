import { ForbiddenException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PaginatedResult } from '../common/pagination/paginated-result.js';

import {
  AuditExportService,
  type AuditExportCsvResult,
} from './audit-export.service.js';
import {
  AuditCompleteExportQueryDto,
  AuditExportQueryDto,
  AuditLogEntryDto,
} from './dto/audit-export-query.dto.js';
import { AuditLogEntry } from './entities/audit-log-entry.entity.js';
import { AuditAction } from './enums/audit-action.enum.js';
import { AuditExportFormat } from './enums/audit-export-format.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';
import type { Repository } from 'typeorm';

describe('AuditExportService', () => {
  let service: AuditExportService;
  let qb: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    clone: jest.Mock;
    getCount: jest.Mock;
    getMany: jest.Mock;
    getManyAndCount: jest.Mock;
  };
  const LIMIT = 1000;

  const createQueryBuilder = jest.fn();

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      clone: jest.fn().mockReturnThis(),
      getCount: jest.fn(),
      getMany: jest.fn(),
      getManyAndCount: jest.fn(),
    };
    createQueryBuilder.mockReturnValue(qb);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditExportService,
        {
          provide: getRepositoryToken(AuditLogEntry),
          useValue: {
            createQueryBuilder,
          } as Pick<Repository<AuditLogEntry>, 'createQueryBuilder'>,
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: unknown) =>
              key === 'app.audit.exportMaxRows' ? LIMIT : fallback,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AuditExportService);
  });

  const user = {
    id: 'user-1',
    organisationId: 'org-1',
  } as AuthenticatedUser;

  it('throws when active organisation is missing', async () => {
    await expect(
      service.export(
        { id: 'user-1' } as AuthenticatedUser,
        new AuditExportQueryDto(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('returns paginated JSON export', async () => {
    const createdAt = new Date('2026-01-02T12:00:00.000Z');
    qb.getManyAndCount.mockResolvedValueOnce([
      [
        {
          id: 'audit-1',
          createdAt,
          actorUserId: 'user-1',
          organisationId: 'org-1',
          entityType: 'invitations',
          entityId: 'inv-1',
          action: AuditAction.INSERT,
          changes: { email: { to: 'a@example.com' } },
        },
      ],
      1,
    ]);

    const query = Object.assign(new AuditExportQueryDto(), {
      format: AuditExportFormat.JSON,
      page: 1,
      perPage: 20,
      entityType: 'invitations',
      action: AuditAction.INSERT,
    });

    const result = await service.export(user, query);

    expect(result).toBeInstanceOf(PaginatedResult);
    const paginated = result as PaginatedResult<AuditLogEntryDto>;
    expect(paginated.items[0]).toEqual(
      expect.objectContaining({
        id: 'audit-1',
        entityType: 'invitations',
        action: AuditAction.INSERT,
      }),
    );
    expect(paginated.meta.total).toBe(1);

    expect(qb.andWhere).toHaveBeenCalledWith('audit.entityType = :entityType', {
      entityType: 'invitations',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('audit.action = :action', {
      action: AuditAction.INSERT,
    });
  });

  it('returns CSV export with meta headers data', async () => {
    qb.getManyAndCount.mockResolvedValueOnce([[], 0]);

    const query = Object.assign(new AuditExportQueryDto(), {
      format: AuditExportFormat.CSV,
      page: 2,
      perPage: 10,
    });

    const result = await service.export(user, query);
    const csvResult = result as AuditExportCsvResult;

    expect(csvResult.csv).toContain('id,createdAt');
    expect(csvResult.meta.page).toBe(2);
  });

  /**
   * The complete export: every entry in scope, or an error. The provider's
   * panel used to save the paginated endpoint's default twenty rows as "the
   * audit log".
   */
  describe('exportAll', () => {
    const entry = (i: number) => ({
      id: `audit-${i}`,
      createdAt: new Date('2026-01-02T12:00:00.000Z'),
      actorUserId: 'user-1',
      organisationId: 'org-1',
      entityType: 'invitations',
      entityId: `entity-${i}`,
      action: AuditAction.INSERT,
      changes: {},
    });

    it('returns every entry in scope with its total and filters, in a total order, unpaged', async () => {
      const rows = Array.from({ length: 250 }, (_, i) => entry(i));
      qb.getCount.mockResolvedValueOnce(250);
      qb.getMany.mockResolvedValueOnce(rows);
      const query = Object.assign(new AuditCompleteExportQueryDto(), {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.999Z',
      });

      const result = await service.exportAll(user, query);

      expect(result.total).toBe(250);
      expect(result.entries).toHaveLength(250);
      expect(result.organisationId).toBe('org-1');
      expect(result.filters).toEqual({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.999Z',
        entityType: null,
        action: null,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('audit.createdAt >= :from', {
        from: '2026-01-01T00:00:00.000Z',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('audit.createdAt <= :to', {
        to: '2026-01-31T23:59:59.999Z',
      });
      expect(qb.orderBy).toHaveBeenCalledWith('audit.createdAt', 'DESC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('audit.id', 'DESC');
      expect(qb.skip).not.toHaveBeenCalled();
      // One row over the limit, so a late write cannot slip past it.
      expect(qb.take).toHaveBeenCalledWith(LIMIT + 1);
    });

    it('refuses with 413 and the count when the scope is over the limit — no partial file', async () => {
      qb.getCount.mockResolvedValueOnce(73412);

      const error = await service
        .exportAll(user, new AuditCompleteExportQueryDto())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PayloadTooLargeException);
      expect((error as Error).message).toContain('73,412');
      expect((error as Error).message).toContain('narrower date range');
      expect(qb.getMany).not.toHaveBeenCalled();
    });

    it('refuses when rows written after the count push the read over the limit', async () => {
      qb.getCount.mockResolvedValueOnce(LIMIT);
      qb.getMany.mockResolvedValueOnce(
        Array.from({ length: LIMIT + 1 }, (_, i) => entry(i)),
      );

      await expect(
        service.exportAll(user, new AuditCompleteExportQueryDto()),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('throws when the active organisation is missing', async () => {
      await expect(
        service.exportAll(
          { id: 'user-1' } as AuthenticatedUser,
          new AuditCompleteExportQueryDto(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
