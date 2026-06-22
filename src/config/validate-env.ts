import {
  applyDeployedCronDefaults,
  envSchema,
  type Env,
} from './env.schema.js';

import type { ZodError } from 'zod';

let cached: Env | undefined;

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

export function parseEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(applyDeployedCronDefaults(raw));
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${formatZodError(result.error)}`,
    );
  }
  return result.data;
}

/** Parse and cache from the given env record (used by Nest ConfigModule.validate). */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  cached = parseEnv(config);
  return config;
}

/** Parse `process.env` and cache (CLI / bootstrap before Nest). */
export function parseEnvFromProcess(): Env {
  cached = parseEnv(process.env);
  return cached;
}

export function getEnv(): Env {
  if (cached === undefined) {
    return parseEnvFromProcess();
  }
  return cached;
}

/** Clears cached env (e2e suites that reconfigure process.env before importing AppModule). */
export function resetEnvCache(): void {
  cached = undefined;
}
