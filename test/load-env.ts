import path from 'path';

import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '..', '.env.test') });

process.env.NODE_ENV = 'test';
process.env.TENANT_DB_CONTEXT_ENABLED = 'true';
process.env.THROTTLE_ENABLED = 'false';
process.env.OIDC_ENABLED = 'false';
process.env.EMAIL_PROVIDER = 'noop';
process.env.FRONTEND_BASE_URL = 'http://localhost:3001';
process.env.QUEUE_OPS_ENABLED = 'true';
process.env.QUEUE_OPS_API_KEY = 'test-queue-ops-api-key-min-32-chars!!';
process.env.ILR_ESFA_PROVIDER = 'noop';
process.env.ILR_CONFIG_WRITE_ENABLED = 'true';

import '../src/database/postgres-query-runner.patch.js';
