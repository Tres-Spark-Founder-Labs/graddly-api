import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module.js';
import { BullmqJobInspectionService } from '../src/bullmq/bullmq-job-inspection.service.js';
import { QUEUE_SYSTEM } from '../src/bullmq/bullmq.constants.js';
import { QUEUE_OPS_API_KEY_HEADER } from '../src/bullmq/queue-ops.constants.js';
import { buildPaginationMeta } from '../src/common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../src/common/pagination/paginated-result.js';
import { configureApp } from '../src/configure-app.js';

import { createE2eApp } from './helpers/e2e-app.js';
import {
  expectFilteredHttpExceptionBody,
  expectPaginatedListEnvelope,
  expectSuccessEnvelope,
} from './helpers/e2e-response-contracts.js';
import {
  applyQueueOpsE2eEnv,
  disableQueueOpsE2eEnv,
  E2E_QUEUE_OPS_API_KEY,
} from './helpers/queue-ops-e2e-env.js';

function opsAuthHeaders(
  apiKey: string = E2E_QUEUE_OPS_API_KEY,
): Record<string, string> {
  return { [QUEUE_OPS_API_KEY_HEADER]: apiKey };
}

describe('BullmqOpsController (e2e)', () => {
  let app: INestApplication<App>;

  const inspectionMock: jest.Mocked<
    Pick<
      BullmqJobInspectionService,
      'listQueues' | 'listFailedJobs' | 'getJob' | 'retryJob' | 'removeJob'
    >
  > = {
    listQueues: jest.fn(),
    listFailedJobs: jest.fn(),
    getJob: jest.fn(),
    retryJob: jest.fn(),
    removeJob: jest.fn(),
  };

  beforeAll(async () => {
    applyQueueOpsE2eEnv();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BullmqJobInspectionService)
      .useValue(inspectionMock)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    disableQueueOpsE2eEnv();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    inspectionMock.listQueues.mockResolvedValue([
      {
        name: QUEUE_SYSTEM,
        counts: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 1,
          delayed: 0,
          prioritized: 0,
          waitingChildren: 0,
        },
      },
    ]);
    inspectionMock.listFailedJobs.mockResolvedValue(
      new PaginatedResult(
        [
          {
            id: 'job-1',
            name: 'ping',
            attemptsMade: 3,
            failedReason: 'e2e failure',
            timestamp: 1,
            finishedOn: 2,
          },
        ],
        buildPaginationMeta({ total: 1, page: 1, perPage: 10 }),
      ),
    );
    inspectionMock.getJob.mockResolvedValue({
      id: 'job-1',
      name: 'ping',
      attemptsMade: 3,
      failedReason: 'e2e failure',
      timestamp: 1,
      finishedOn: 2,
      data: { ping: true },
      stacktrace: ['Error: e2e failure'],
      opts: { attempts: 3 },
    });
    inspectionMock.retryJob.mockResolvedValue(undefined);
    inspectionMock.removeJob.mockResolvedValue(undefined);
  });

  describe('authentication', () => {
    it('returns 401 when the ops API key header is missing', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/ops/queues')
        .expect(401);

      expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
        statusCode: 401,
        message: 'Invalid queue ops API key',
        path: '/api/v1/ops/queues',
        error: 'Unauthorized',
      });
    });

    it('returns 401 when the ops API key is wrong', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/ops/queues')
        .set(opsAuthHeaders('wrong-key'))
        .expect(401);

      expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
        statusCode: 401,
        message: 'Invalid queue ops API key',
        path: '/api/v1/ops/queues',
        error: 'Unauthorized',
      });
    });
  });

  describe('with valid ops API key', () => {
    it('GET /api/v1/ops/queues returns queue summaries', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/ops/queues')
        .set(opsAuthHeaders())
        .expect(200);

      expectSuccessEnvelope(res.body);
      expect(res.body).toEqual({
        message: 'Queue summaries retrieved successfully',
        data: [
          {
            name: QUEUE_SYSTEM,
            counts: expect.objectContaining({ failed: 1 }),
          },
        ],
      });
      expect(inspectionMock.listQueues).toHaveBeenCalled();
    });

    it('GET /api/v1/ops/queues/:queue/jobs/failed returns paginated failed jobs', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/ops/queues/${QUEUE_SYSTEM}/jobs/failed?page=1&perPage=10`)
        .set(opsAuthHeaders())
        .expect(200);

      expectPaginatedListEnvelope(res.body);
      expect(res.body).toMatchObject({
        message: 'Failed jobs retrieved successfully',
        data: [
          {
            id: 'job-1',
            name: 'ping',
            attemptsMade: 3,
            failedReason: 'e2e failure',
          },
        ],
        meta: { total: 1, page: 1, perPage: 10 },
      });
      expect(inspectionMock.listFailedJobs).toHaveBeenCalledWith(
        QUEUE_SYSTEM,
        1,
        10,
      );
    });

    it('GET /api/v1/ops/queues/:queue/jobs/:jobId returns job detail', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/ops/queues/${QUEUE_SYSTEM}/jobs/job-1`)
        .set(opsAuthHeaders())
        .expect(200);

      expectSuccessEnvelope(res.body);
      expect(res.body).toMatchObject({
        message: 'Queue job retrieved successfully',
        data: {
          id: 'job-1',
          data: { ping: true },
          stacktrace: ['Error: e2e failure'],
        },
      });
      expect(inspectionMock.getJob).toHaveBeenCalledWith(QUEUE_SYSTEM, 'job-1');
    });

    it('POST .../retry returns 204 and delegates to inspection service', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/ops/queues/${QUEUE_SYSTEM}/jobs/job-1/retry`)
        .set(opsAuthHeaders())
        .expect(204);

      expect(inspectionMock.retryJob).toHaveBeenCalledWith(
        QUEUE_SYSTEM,
        'job-1',
      );
    });

    it('DELETE .../jobs/:jobId returns 204 and delegates to inspection service', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/ops/queues/${QUEUE_SYSTEM}/jobs/job-1`)
        .set(opsAuthHeaders())
        .expect(204);

      expect(inspectionMock.removeJob).toHaveBeenCalledWith(
        QUEUE_SYSTEM,
        'job-1',
      );
    });
  });
});

describe('BullmqOpsController (e2e, disabled)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    disableQueueOpsE2eEnv();
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
    applyQueueOpsE2eEnv();
  });

  it('returns 403 when queue ops is disabled', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ops/queues')
      .set(opsAuthHeaders())
      .expect(403);

    expectFilteredHttpExceptionBody(res.body as Record<string, unknown>, {
      statusCode: 403,
      message: 'Queue ops API is disabled',
      path: '/api/v1/ops/queues',
      error: 'Forbidden',
    });
  });
});

describe('BullmqOpsController (e2e, Redis integration)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    applyQueueOpsE2eEnv();
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/ops/queues lists all registered queues from Redis', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ops/queues')
      .set(opsAuthHeaders())
      .expect(200);

    expectSuccessEnvelope(res.body);
    const names = (res.body as { data: { name: string }[] }).data.map(
      (q) => q.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'email',
        'digest',
        'pdf',
        'das-sync',
        'das-sync-dlq',
        'withdrawal-push',
        'evidence-pack',
        'system',
      ]),
    );
    expect(names).toHaveLength(8);
  });
});
