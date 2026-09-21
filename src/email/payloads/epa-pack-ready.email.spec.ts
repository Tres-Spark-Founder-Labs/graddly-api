import { ConfigService } from '@nestjs/config';

import { EmailTemplate } from '../email-template.enum.js';

import { EpaPackReadyEmail } from './epa-pack-ready.email.js';

describe('EpaPackReadyEmail', () => {
  const configWith = (values: [string, unknown][]) => {
    const map = new Map<string, unknown>(values);
    return {
      get: (key: string, fallback?: unknown) => map.get(key) ?? fallback,
    } as ConfigService;
  };

  it('states the configured expiry and the absolute UK time the link stops working', () => {
    const payload = EpaPackReadyEmail.create(
      configWith([
        ['app.epaPack.emailLinkTtlSeconds', 86400],
        ['app.frontend.portalUrls', { apprentice: 'https://me.example.com/' }],
      ]),
      {
        to: 'apprentice@example.com',
        firstName: 'Sam',
        downloadUrl: 'https://bucket.example.com/pack.zip?X-Amz-Expires=86400',
        // 09:15 UTC in September is 10:15 BST.
        expiresAt: new Date('2026-09-22T09:15:00.000Z'),
      },
    );

    expect(payload.template).toBe(EmailTemplate.EPA_PACK_READY);
    expect(payload.to).toBe('apprentice@example.com');
    expect(payload.getTemplateContext()).toEqual({
      firstName: 'Sam',
      downloadUrl: 'https://bucket.example.com/pack.zip?X-Amz-Expires=86400',
      expiresInLabel: '24 hours',
      expiresAtLabel: '22 Sept 2026, 10:15',
      packPageUrl: 'https://me.example.com/epa-pack',
    });
  });

  it('leaves the pack page link empty when the apprentice portal URL is not configured', () => {
    const payload = EpaPackReadyEmail.create(
      configWith([['app.epaPack.emailLinkTtlSeconds', 7200]]),
      {
        to: 'apprentice@example.com',
        firstName: 'Sam',
        downloadUrl: 'https://bucket.example.com/pack.zip',
        expiresAt: new Date('2026-01-10T12:00:00.000Z'),
      },
    );

    expect(payload.getTemplateContext()).toMatchObject({
      expiresInLabel: '2 hours',
      expiresAtLabel: '10 Jan 2026, 12:00',
      packPageUrl: '',
    });
  });
});
