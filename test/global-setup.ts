import * as fs from 'fs';
import * as path from 'path';

import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.test') });

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

  await pg.end();
}
