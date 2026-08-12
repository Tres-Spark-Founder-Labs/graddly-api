/**
 * `ioredis` is mocked before anything imports it.
 *
 * Compiling `WorkerModule` instantiates `BullmqModule`, which builds real
 * BullMQ queues, which open real Redis sockets. In CI there is no Redis on the
 * unit-test job, so those sockets retry in the background and emit
 * `ECONNREFUSED` long after the suite has finished — Jest then reports "Cannot
 * log after tests are done" and the run can hang on open handles.
 *
 * The point of this spec is that Nest can *resolve the dependency graph*. It
 * does not need a working queue to prove that, so the transport is faked and
 * the wiring is left real.
 */
/* eslint-disable @typescript-eslint/naming-convention -- the mocked module
   re-exports ioredis's own names (`Redis`, `Cluster`, `__esModule`), which are
   not ours to rename. */
/* eslint-disable @typescript-eslint/no-require-imports -- `jest.mock` factories
   are hoisted above the import block, so a statically imported binding is not
   initialised yet when this runs. A block disable rather than a next-line one
   because prettier wraps the call across two lines and the directive would
   then point at the wrong one. */
jest.mock('ioredis', () => {
  const { EventEmitter } =
    require('node:events') as typeof import('node:events');

  /**
   * Extends `EventEmitter` rather than stubbing `on`/`emit` by hand: BullMQ
   * calls `getMaxListeners()` on the connection, which a hand-rolled object
   * does not have. Inheriting the real emitter gets the whole contract for
   * free.
   */
  class FakeRedis extends EventEmitter {
    status = 'ready';
    options = {};
    connect() {
      return Promise.resolve();
    }
    disconnect() {}
    quit() {
      return Promise.resolve('OK');
    }
    duplicate() {
      return new FakeRedis();
    }
    defineCommand() {}
    info() {
      // BullMQ refuses to start against Redis < 5.0.0, so report a modern one.
      return Promise.resolve('redis_version:7.4.0\r\n');
    }
    client() {
      return Promise.resolve('OK');
    }
  }

  return {
    __esModule: true,
    default: FakeRedis,
    Redis: FakeRedis,
    Cluster: FakeRedis,
  };
});
/* eslint-enable @typescript-eslint/naming-convention */
/* eslint-enable @typescript-eslint/no-require-imports */

import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { WorkerModule } from './worker.module.js';

/**
 * The worker is a **second root module**. Nothing else in the suite boots it:
 * unit tests mock their providers, and every e2e spec boots `AppModule`. So a
 * provider added to a service used by both processes resolves fine in the API
 * and crashes the worker at launch, with no test failing anywhere.
 *
 * That has now happened three times — twice in 2f32cc1, and again when
 * `LearnerScopeService` was injected into `PdfJobsService` during the
 * learner-scope work. The failure mode is severe out of proportion to the
 * mistake: `npm start` runs both under `concurrently -k`, so a dead worker
 * takes the HTTP API down with it. Every background job *and* the whole API
 * stop.
 *
 * This compiles the real module graph with the database and the Redis
 * transport faked out, so a missing import fails here instead of at launch.
 */
describe('WorkerModule', () => {
  it('resolves every provider in its dependency graph', async () => {
    const dataSource = {
      // Enough surface for TypeOrmModule.forFeature to hand out repositories.
      // `entityMetadatas` must exist and be iterable: `@nestjs/typeorm`'s
      // repository factory calls `.find()` on it before falling back to
      // `getRepository`, and an undefined property fails there rather than
      // anywhere informative.
      entityMetadatas: [],
      getRepository: jest.fn().mockReturnValue({}),
      options: { type: 'postgres' },
      createEntityManager: jest.fn().mockReturnValue({}),
      isInitialized: true,
      destroy: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    })
      .overrideProvider(getDataSourceToken())
      .useValue(dataSource)
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 60_000);
});
