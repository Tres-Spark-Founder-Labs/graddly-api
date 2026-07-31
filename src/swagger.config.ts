import { DocumentBuilder } from '@nestjs/swagger';

/**
 * Shared between the running app (`/docs`) and `scripts/emit-openapi.ts`.
 *
 * Extracted so the spec the frontend generates its types from is provably the
 * same document the API serves, rather than a second definition that can drift
 * from it.
 */
export function buildSwaggerConfig() {
  return new DocumentBuilder()
    .setTitle('Graddly API')
    .setDescription('The Graddly API documentation')
    .setVersion('0.1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'JWT access token. Claims: `sub` (user id), `email`, optional `orgId` (active organisation), optional `roles` (roles in that org). See docs/api/jwt-payload.md for details and client migration.',
    })
    .build();
}
