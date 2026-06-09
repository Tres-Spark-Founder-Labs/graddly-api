import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { createE2eApp } from './helpers/e2e-app.js';

describe('Security headers (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/v1/health', () => {
    it('sets baseline API security headers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['content-security-policy']).toBeUndefined();
    });
  });

  describe('GET /docs', () => {
    it('sets Scalar CSP allowing cdn.jsdelivr.net', async () => {
      const res = await request(app.getHttpServer()).get('/docs');

      const csp = res.headers['content-security-policy'];
      expect(typeof csp).toBe('string');
      expect(csp).toContain('cdn.jsdelivr.net');
    });
  });
});
