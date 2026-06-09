# Security headers (SEC-001)

Helmet is configured in [`src/configure-helmet.ts`](../src/configure-helmet.ts) and applied in [`src/main.ts`](../src/main.ts). E2e tests use the same setup via [`test/helpers/e2e-app.ts`](../test/helpers/e2e-app.ts).

## Route profiles

| Header | API routes (`/api/*`) | Scalar `/docs` |
|--------|----------------------|----------------|
| `Strict-Transport-Security` | Helmet default (`max-age=15552000; includeSubDomains`) | Same |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `X-Frame-Options` | Helmet default (`SAMEORIGIN`) | Helmet default |
| `Referrer-Policy` | Helmet default | Helmet default |
| `Cross-Origin-Opener-Policy` | Helmet default | Helmet default |
| `Cross-Origin-Resource-Policy` | Helmet default | Helmet default |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Not set (Scalar profile) |
| `Content-Security-Policy` | **Disabled** (JSON API; no HTML) | CDN + inline script allowlist for Scalar |

## Scalar exception

`/docs` serves the Scalar API reference from a CDN with inline boot scripts. That route is protected with HTTP basic auth in production bootstrap (`main.ts`). CSP for `/docs` intentionally includes `unsafe-inline`, `unsafe-eval`, and `https://cdn.jsdelivr.net` — see [scalar/scalar#727](https://github.com/scalar/scalar/issues/727).

## HSTS and HTTPS

HSTS is emitted on all responses. It takes effect for browsers only when the API is served over HTTPS at the edge (load balancer / ingress). Aligns with PRD §7.2 security requirements.

## Verification

```bash
yarn test:e2e security-headers
```

## SEC-001 sign-off checklist

- [ ] API routes omit CSP; framing and MIME-sniff protections present
- [ ] `/docs` CSP includes Scalar CDN allowlist
- [ ] HSTS header present (effective when TLS terminates at edge)
- [ ] E2e contract in `test/security-headers.e2e-spec.ts` passes
