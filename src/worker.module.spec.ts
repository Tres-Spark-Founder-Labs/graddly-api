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
 * This compiles the real module graph with only the database faked out, so a
 * missing import fails here instead of at `npm start`.
 */
describe('WorkerModule', () => {
  it('resolves every provider in its dependency graph', async () => {
    const dataSource = {
      // Enough surface for TypeOrmModule.forFeature to hand out repositories.
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
