import {
  runWithCorrelationId,
  runWithTenantContext,
  setCurrentOrganisationId,
  setCurrentUserId,
  withRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import * as validateEnv from '../config/validate-env.js';

import {
  applyTenantGucs,
  setGucQueryRunner,
  TENANT_GUC_SQL,
} from './apply-tenant-gucs.js';

function minimalEnv(tenantDbContextEnabled: boolean) {
  /* eslint-disable @typescript-eslint/naming-convention -- keys mirror process.env */
  return {
    ...validateEnv.parseEnv({
      NODE_ENV: 'development',
      JWT_SECRET: 'change-me-in-production',
    }),
    TENANT_DB_CONTEXT_ENABLED: tenantDbContextEnabled,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

describe('applyTenantGucs', () => {
  const queryRunner = {
    query: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv(false));
    setGucQueryRunner(queryRunner.query);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does nothing when TENANT_DB_CONTEXT_ENABLED is false', async () => {
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv(false));
    await runWithCorrelationId('cid', async () => {
      setCurrentOrganisationId('org-1');
      await applyTenantGucs(queryRunner as never);
    });
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  /**
   * The store, and nothing else. There is no fallback to fall back to: a
   * store with neither value sends '' for both, and so does no store at all.
   * '' matches no policy, so the statement sees no tenant rather than the
   * last one some other request or job wrote.
   */
  it('sends empty org and user when the store carries neither', async () => {
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv(true));
    await runWithCorrelationId('no-tenant', () =>
      applyTenantGucs(queryRunner as never),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(TENANT_GUC_SQL, [
      '',
      '',
      '0',
    ]);
  });

  it('sends empty org and user with no store at all', async () => {
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv(true));
    await applyTenantGucs(queryRunner as never);
    expect(queryRunner.query).toHaveBeenCalledWith(TENANT_GUC_SQL, [
      '',
      '',
      '0',
    ]);
  });

  it('sends the values a job entered its store with', async () => {
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv(true));
    await runWithTenantContext(
      {
        label: 'pdf:generate#1',
        organisationId: '770e8400-e29b-41d4-a716-446655440002',
        userId: '880e8400-e29b-41d4-a716-446655440003',
      },
      () => applyTenantGucs(queryRunner as never),
    );
    expect(queryRunner.query).toHaveBeenCalledWith(TENANT_GUC_SQL, [
      '770e8400-e29b-41d4-a716-446655440002',
      '880e8400-e29b-41d4-a716-446655440003',
      '0',
    ]);
  });

  it('sets all GUCs from tenant request context when enabled', async () => {
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv(true));
    await runWithCorrelationId('cid', async () => {
      setCurrentOrganisationId('550e8400-e29b-41d4-a716-446655440000');
      setCurrentUserId('660e8400-e29b-41d4-a716-446655440001');
      await withRlsBootstrap(() => applyTenantGucs(queryRunner as never));
    });
    expect(queryRunner.query).toHaveBeenCalledWith(TENANT_GUC_SQL, [
      '550e8400-e29b-41d4-a716-446655440000',
      '660e8400-e29b-41d4-a716-446655440001',
      '1',
    ]);
  });
});

/**
 * withRlsBootstrap is safe by construction, and these are the reasons.
 *
 * setRlsBootstrap(true) assigned the flag on the request's store — the object
 * every sibling async operation already held — and wrote a process-global
 * fallback the resolver OR-ed in. Each test below is one way that leaked,
 * run against the helper that replaced it.
 */
describe('withRlsBootstrap — the GUC each statement sends', () => {
  const bootstrapSent = (runner: jest.Mock): string[] =>
    (runner.mock.calls as [string, string[]][]).map(([, params]) => params[2]);

  beforeEach(() => {
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv(true));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not reach a sibling read running beside the window', async () => {
    const insideWindow = jest.fn().mockResolvedValue(undefined);
    const sibling = jest.fn().mockResolvedValue(undefined);

    await runWithCorrelationId('one-request', async () => {
      let release = (): void => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      await Promise.all([
        withRlsBootstrap(async () => {
          // Held open until the sibling has sent its statement.
          await gate;
          setGucQueryRunner(insideWindow);
          await applyTenantGucs({} as never);
        }),
        (async () => {
          setGucQueryRunner(sibling);
          await applyTenantGucs({} as never);
          release();
        })(),
      ]);
    });

    expect(bootstrapSent(sibling)).toEqual(['0']);
    expect(bootstrapSent(insideWindow)).toEqual(['1']);
  });

  it('leaves nothing on after two windows overlap and finish out of order', async () => {
    const after = jest.fn().mockResolvedValue(undefined);

    await runWithCorrelationId('one-request', async () => {
      let releaseFirst = (): void => {};
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      // The first window opens first and closes last.
      await Promise.all([
        withRlsBootstrap(() => firstGate),
        withRlsBootstrap(async () => {
          await Promise.resolve();
          releaseFirst();
        }),
      ]);

      setGucQueryRunner(after);
      await applyTenantGucs({} as never);
    });

    expect(bootstrapSent(after)).toEqual(['0']);
  });

  it('does not reach another request while a window is open', async () => {
    const otherRequest = jest.fn().mockResolvedValue(undefined);
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await Promise.all([
      runWithCorrelationId('request-a', () => withRlsBootstrap(() => gate)),
      runWithCorrelationId('request-b', async () => {
        setGucQueryRunner(otherRequest);
        await applyTenantGucs({} as never);
        release();
      }),
    ]);

    expect(bootstrapSent(otherRequest)).toEqual(['0']);
  });

  it('still applies for a job with no store at all', async () => {
    const cron = jest.fn().mockResolvedValue(undefined);
    setGucQueryRunner(cron);

    await withRlsBootstrap(() => applyTenantGucs({} as never));

    expect(bootstrapSent(cron)).toEqual(['1']);
  });
});
