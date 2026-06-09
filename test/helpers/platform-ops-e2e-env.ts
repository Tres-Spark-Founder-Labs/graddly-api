import {
  parseEnvFromProcess,
  resetEnvCache,
} from '../../src/config/validate-env.js';

/** Min 32 chars — matches staging/production validation when ops is enabled. */
export const E2E_PLATFORM_OPS_API_KEY =
  'test-platform-ops-api-key-min-32-chars!';

export function applyPlatformOpsE2eEnv(): void {
  process.env.PLATFORM_OPS_ENABLED = 'true';
  process.env.PLATFORM_OPS_API_KEY = E2E_PLATFORM_OPS_API_KEY;
  resetEnvCache();
  parseEnvFromProcess();
}

export function disablePlatformOpsE2eEnv(): void {
  process.env.PLATFORM_OPS_ENABLED = 'false';
  process.env.PLATFORM_OPS_API_KEY = '';
  resetEnvCache();
  parseEnvFromProcess();
}
