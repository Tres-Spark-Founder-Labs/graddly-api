import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { EmailLayoutContextService } from './email-layout-context.service.js';

describe('EmailLayoutContextService', () => {
  const configGet = jest.fn();
  let service: EmailLayoutContextService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailLayoutContextService,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    service = moduleRef.get(EmailLayoutContextService);
  });

  describe('getLayoutContext', () => {
    it('returns layout context from config', () => {
      configGet.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'app.email.appName') return 'Graddly Test';
        if (key === 'app.email.supportUrl')
          return 'https://support.example.com';
        if (key === 'app.email.privacyUrl')
          return 'https://privacy.example.com';
        return defaultValue;
      });

      const context = service.getLayoutContext();

      expect(context).toEqual({
        appName: 'Graddly Test',
        copyrightYear: new Date().getFullYear(),
        supportUrl: 'https://support.example.com',
        privacyUrl: 'https://privacy.example.com',
      });
    });

    it('falls back to default app name', () => {
      configGet.mockImplementation(
        (_key: string, defaultValue?: unknown) => defaultValue,
      );

      const context = service.getLayoutContext();

      expect(context.appName).toBe('Graddly');
      expect(context.supportUrl).toBeUndefined();
      expect(context.privacyUrl).toBeUndefined();
    });
  });
});
