import helmet from 'helmet';

import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** Baseline header profiles: docs/security-headers.md */

/** Scalar API reference (CDN + inline boot script). See scalar/scalar#727. */
const scalarDocsHelmet = helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        'https://cdn.jsdelivr.net',
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://cdn.jsdelivr.net',
        'https://fonts.googleapis.com',
      ],
      fontSrc: [
        "'self'",
        'https://fonts.gstatic.com',
        'https://fonts.scalar.com',
        'data:',
      ],
      imgSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
      connectSrc: ["'self'"],
    },
  },
});

/** JSON API routes — no CSP (non-HTML); HSTS and framing policies from Helmet defaults. */
const defaultHelmet = helmet({
  contentSecurityPolicy: false,
});

const permissionsPolicyMiddleware = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  next();
};

function isApiDocsPath(path: string): boolean {
  return path === '/docs' || path.startsWith('/docs/');
}

export function configureHelmet(app: INestApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isApiDocsPath(req.path)) {
      scalarDocsHelmet(req, res, next);
      return;
    }
    defaultHelmet(req, res, () => {
      permissionsPolicyMiddleware(req, res, next);
    });
  });
}
