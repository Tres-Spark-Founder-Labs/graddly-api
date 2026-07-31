/* eslint-disable no-console */
/**
 * Writes the OpenAPI document to `openapi.json`.
 *
 * The spec has always existed — `SwaggerModule.createDocument` runs on every
 * boot to serve `/docs` — but only in memory, in a running process. Nothing
 * could consume it as an artifact, which is why the frontend has been hand-
 * writing its assumptions about every response shape and getting them wrong:
 * the £0.00 levy balance, the discarded `standardDisplayName`, the phantom
 * `otjBehindPercent`, the `off_track` value no screen recognised. Each of
 * those is the same failure — a field name that exists on one side of the
 * wire and not the other, with nothing to compare them against.
 *
 * Committed to the repository on purpose. The frontend's type generation must
 * not require a running API or a database, or it becomes something people skip
 * when it is inconvenient — which is exactly when drift creeps in.
 *
 * Uses Nest's preview mode: modules and controllers are registered so routes
 * and DTO metadata can be read, but providers are never instantiated, so this
 * needs no database, Redis, or credentials.
 */
import 'dotenv/config';

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from '../src/app.module.js';
import { buildSwaggerConfig } from '../src/swagger.config.js';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });

  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  await app.close();

  const outputPath = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  const pathCount = Object.keys(document.paths ?? {}).length;
  const schemaCount = Object.keys(document.components?.schemas ?? {}).length;
  console.log(
    `✓ Wrote ${outputPath} (${pathCount} paths, ${schemaCount} schemas)`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
