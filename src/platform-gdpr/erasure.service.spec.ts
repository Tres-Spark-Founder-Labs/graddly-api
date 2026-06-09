import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Apprentice } from '../apprentices/entities/apprentice.entity.js';
import { ERASED, scrubAuditChanges } from '../audit/audit-scrub.util.js';
import { AuditLogEntry } from '../audit/entities/audit-log-entry.entity.js';
import { RefreshTokenService } from '../auth/refresh-token.service.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { Message } from '../messaging/entities/message.entity.js';
import { OtjLogEntry } from '../otj/entities/otj-log-entry.entity.js';
import { User } from '../users/entities/user.entity.js';

import { ErasureSubjectType } from './dto/erasure-request.dto.js';
import { ErasureService } from './erasure.service.js';

describe('ErasureService', () => {
  const userRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
  const apprenticeRepo = { findOne: jest.fn(), save: jest.fn() };
  const enrolmentRepo = { find: jest.fn() };
  const otjRepo = { createQueryBuilder: jest.fn() };
  const messageRepo = { createQueryBuilder: jest.fn() };
  const auditRepo = {
    createQueryBuilder: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const refreshTokenService = { revokeAllForUser: jest.fn() };

  let service: ErasureService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ErasureService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Apprentice), useValue: apprenticeRepo },
        { provide: getRepositoryToken(Enrolment), useValue: enrolmentRepo },
        { provide: getRepositoryToken(OtjLogEntry), useValue: otjRepo },
        { provide: getRepositoryToken(Message), useValue: messageRepo },
        { provide: getRepositoryToken(AuditLogEntry), useValue: auditRepo },
        { provide: RefreshTokenService, useValue: refreshTokenService },
      ],
    }).compile();

    service = moduleRef.get(ErasureService);
    jest.clearAllMocks();

    auditRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    });
    auditRepo.create.mockImplementation((value: unknown) => value);
    auditRepo.save.mockImplementation((value: unknown) =>
      Promise.resolve(value),
    );
    otjRepo.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    });
    messageRepo.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    });
  });

  it('scrubs known PII fields in audit JSON', () => {
    const scrubbed = scrubAuditChanges({
      email: { from: 'a@b.com', to: 'c@d.com' },
      firstName: { from: 'Jane', to: 'Janet' },
    });
    expect(scrubbed.email).toEqual({ from: ERASED, to: ERASED });
    expect(scrubbed.firstName).toEqual({ from: ERASED, to: ERASED });
  });

  it('anonymises user fields and revokes sessions', async () => {
    const user = {
      id: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '07000000000',
      dateOfBirth: new Date('1990-01-01'),
      avatarUrl: 'https://example.com/a.png',
      bio: 'Hello',
      isActive: true,
    };
    userRepo.findOne.mockResolvedValue(user);
    userRepo.save.mockImplementation((u: Record<string, unknown>) =>
      Promise.resolve(u),
    );

    const result = await service.eraseUser('user-1', 'test');

    expect(user.firstName).toBe(ERASED);
    expect(user.email).toBe('erased-user-1@invalid.graddly');
    expect(user.isActive).toBe(false);
    expect(refreshTokenService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(result.subjectType).toBe(ErasureSubjectType.USER);
    expect(result.alreadyErased).toBe(false);
  });

  it('is idempotent on second user erasure call', async () => {
    const user = {
      id: 'user-1',
      firstName: ERASED,
      lastName: ERASED,
      email: 'erased-user-1@invalid.graddly',
      phone: null,
      dateOfBirth: null,
      avatarUrl: null,
      bio: null,
      isActive: false,
    };
    userRepo.findOne.mockResolvedValue(user);

    const result = await service.eraseUser('user-1');

    expect(userRepo.save).not.toHaveBeenCalled();
    expect(result.alreadyErased).toBe(true);
  });

  it('routes erase request to user erasure', async () => {
    const user = {
      id: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: null,
      dateOfBirth: null,
      avatarUrl: null,
      bio: null,
      isActive: true,
    };
    userRepo.findOne.mockResolvedValue(user);
    userRepo.save.mockImplementation((u: Record<string, unknown>) =>
      Promise.resolve(u),
    );

    const result = await service.erase({
      subjectType: ErasureSubjectType.USER,
      subjectId: 'user-1',
    });

    expect(result.subjectType).toBe(ErasureSubjectType.USER);
  });

  it('anonymises apprentice record', async () => {
    const apprentice = {
      id: 'app-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      organisationId: 'org-1',
    };
    apprenticeRepo.findOne.mockResolvedValue(apprentice);
    apprenticeRepo.save.mockImplementation((a: Record<string, unknown>) =>
      Promise.resolve(a),
    );
    enrolmentRepo.find.mockResolvedValue([]);

    const result = await service.eraseApprentice('app-1');

    expect(apprentice.firstName).toBe(ERASED);
    expect(result.subjectType).toBe(ErasureSubjectType.APPRENTICE);
  });
});
