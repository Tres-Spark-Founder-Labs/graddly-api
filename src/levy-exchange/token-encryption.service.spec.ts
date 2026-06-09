import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { TokenEncryptionService } from './services/token-encryption.service.js';

describe('TokenEncryptionService', () => {
  let service: TokenEncryptionService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenEncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              if (key === 'app.levyExchange.donorOAuth.tokenEncryptionKey') {
                return 'test-encryption-key';
              }
              if (key === 'app.jwt.secret') {
                return 'jwt-fallback-secret';
              }
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(TokenEncryptionService);
  });

  it('encrypts and decrypts plaintext round-trip', () => {
    const ciphertext = service.encrypt('secret-access-token');
    expect(ciphertext).not.toBe('secret-access-token');
    expect(service.decrypt(ciphertext)).toBe('secret-access-token');
  });

  it('throws on invalid ciphertext format', () => {
    expect(() => service.decrypt('not-valid')).toThrow(
      'Invalid encrypted token format',
    );
  });
});
