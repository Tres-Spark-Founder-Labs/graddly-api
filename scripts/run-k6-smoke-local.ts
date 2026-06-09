/* eslint-disable no-console */
/**
 * Provisions (if needed) and runs the k6 smoke script using load/k6/.env.local.
 *
 * Usage: yarn load:smoke:local
 *        yarn load:smoke:local -- --fresh   # re-provision user
 */
import 'dotenv/config';

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_FILE = resolve(process.cwd(), 'load/k6/.env.local');
const fresh = process.argv.includes('--fresh');

function loadEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

function run(command: string, args: string[], extraEnv?: Record<string, string>) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (fresh || !existsSync(ENV_FILE)) {
  run('tsx', ['scripts/provision-k6-smoke-user.ts'], {
    BASE_URL: process.env.BASE_URL || 'http://localhost:3010',
  });
}

if (!existsSync(ENV_FILE)) {
  console.error(`Missing ${ENV_FILE}. Run yarn load:setup first.`);
  process.exit(1);
}

const k6Env = loadEnvFile(ENV_FILE);
run('k6', ['run', 'load/k6/smoke.js'], k6Env);
