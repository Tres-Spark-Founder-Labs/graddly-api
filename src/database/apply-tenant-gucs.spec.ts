import {
  enterCorrelationContext,
  getTenantRequestContext,
  resetSynchronousTenantFallback,
  runWithCorrelationId,
  setCurrentOrganisationId,
  setCurrentUserId,
  setRlsBootstrap,
} from '../common/context/correlation-id-context.js';
import * as validateEnv from '../config/validate-env.js';

import {
  applyTenantGucs,
  clearLastKnownOrganisationIdForGuc,
  clearLastKnownUserIdForGuc,
  setGucQueryRunner,
  setLastKnownOrganisationIdForGuc,
  setLastKnownUserIdForGuc,
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

describe('tenant request context map', () => {
  it('stores user id when using enterCorrelationContext', () => {
    enterCorrelationContext('cid-enter');
    setCurrentUserId('user-enter');
    expect(getTenantRequestContext()?.currentUserId).toBe('user-enter');
  });
});

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
    clearLastKnownUserIdForGuc();
    clearLastKnownOrganisationIdForGuc();
  });

  it('does nothing when TENANT_DB_CONTEXT_ENABLED is false', async () => {
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv(false));
    await runWithCorrelationId('cid', async () => {
      setCurrentOrganisationId('org-1');
      await applyTenantGucs(queryRunner as never);
    });
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  it('falls back to last-known org and user ids when ALS is empty', async () => {
    jest.spyOn(validateEnv, 'getEnv').mockReturnValue(minimalEnv(true));
    resetSynchronousTenantFallback();
    enterCorrelationContext('fallback-test');
    setLastKnownOrganisationIdForGuc('770e8400-e29b-41d4-a716-446655440002');
    setLastKnownUserIdForGuc('880e8400-e29b-41d4-a716-446655440003');
    await applyTenantGucs(queryRunner as never);
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
      setRlsBootstrap(true);
      await applyTenantGucs(queryRunner as never);
    });
    expect(queryRunner.query).toHaveBeenCalledWith(TENANT_GUC_SQL, [
      '550e8400-e29b-41d4-a716-446655440000',
      '660e8400-e29b-41d4-a716-446655440001',
      '1',
    ]);
  });
});
