import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RetentionRunLog } from './entities/retention-run-log.entity.js';
import { RetentionRunTrigger } from './enums/retention-run-trigger.enum.js';
import { RetentionRunLogService } from './retention-run-log.service.js';

describe('RetentionRunLogService', () => {
  let service: RetentionRunLogService;
  const save = jest.fn();
  const findAndCount = jest.fn();

  beforeEach(async () => {
    save.mockReset();
    findAndCount.mockReset();
    save.mockImplementation((entity: RetentionRunLog) =>
      Promise.resolve({ ...entity, id: 'log-1' }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        RetentionRunLogService,
        {
          provide: getRepositoryToken(RetentionRunLog),
          useValue: {
            create: jest.fn((v: Partial<RetentionRunLog>) => v),
            save,
            findAndCount,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(RetentionRunLogService);
  });

  it('records a retention run summary', async () => {
    const log = await service.recordRun(RetentionRunTrigger.MANUAL, {
      auditLogsPurged: 1,
      softDeletedPurged: 2,
      oldNotificationsPurged: 3,
    });

    expect(save).toHaveBeenCalled();
    expect(log).toEqual(
      expect.objectContaining({
        id: 'log-1',
        triggeredBy: RetentionRunTrigger.MANUAL,
        auditLogsPurged: 1,
      }),
    );
  });

  it('lists runs with pagination', async () => {
    findAndCount.mockResolvedValue([[{ id: 'log-1' }], 1]);

    const result = await service.listRuns({ page: 1, perPage: 20 });

    expect(findAndCount).toHaveBeenCalledWith({
      order: { ranAt: 'DESC' },
      skip: 0,
      take: 20,
    });
    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });
});
