import * as fs from 'fs';
import * as path from 'path';

import * as dotenv from 'dotenv';
import Redis from 'ioredis';
import { Client } from 'pg';

import { seedAiProgrammeCatalogue } from './helpers/ai-programme-seed';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.test') });

function applyE2eEnvOverrides(): void {
  process.env.DAS_DONOR_OAUTH_AUTHORIZE_URL =
    'https://das.example.com/oauth/authorize';
  process.env.DAS_DONOR_OAUTH_TOKEN_URL = 'https://das.example.com/oauth/token';
  process.env.DAS_DONOR_OAUTH_CLIENT_ID = 'e2e-donor-client-id';
  process.env.DAS_DONOR_OAUTH_CLIENT_SECRET = 'e2e-donor-client-secret';
  process.env.DAS_DONOR_OAUTH_REDIRECT_URI =
    'http://localhost:3000/api/v1/levy-exchange/donor-links/oauth/callback';
  process.env.DAS_DONOR_OAUTH_SCOPE = 'levy.read';
  delete process.env.FRONTEND_BASE_FLOW_URL;
}

export default async function globalSetup(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- dist CJS default export
    const dataSource = require('../dist/src/config/data-source.js')
      .default as import('typeorm').DataSource;
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }
    await dataSource.runMigrations();
    await dataSource.destroy();
  } catch {
    // Migrations may already be applied via CI `yarn migration:run`; requires `yarn build` locally.
  }

  applyE2eEnvOverrides();

  const pg = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_MIGRATION_USERNAME || 'postgres',
    password: process.env.DB_MIGRATION_PASSWORD ?? '',
    database: process.env.DB_NAME || 'graddly_test',
  });

  await pg.connect();

  const tables = await pg.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'migrations'`,
  );

  for (const { tablename } of tables.rows) {
    await pg.query(`TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE`);
  }

  const ilrTable = await pg.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ilr_mapping_configs'`,
  );
  if (ilrTable.rowCount) {
    const seedPath = path.resolve(
      __dirname,
      '../src/ilr/config/seeds/ilr-mapping-2025-26.v1.json',
    );
    const config = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as object;
    await pg.query(
      `INSERT INTO ilr_mapping_configs ("academicYear", version, status, config, "publishedAt")
       VALUES ($1, 1, 'published', $2::jsonb, now())`,
      ['2025-26', JSON.stringify(config)],
    );
  }

  await seedAiProgrammeCatalogue(pg);

  await pg.end();

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  });

  await redis.flushall();
  await redis.quit();
}
