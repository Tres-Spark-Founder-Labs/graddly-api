import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AuditEventService } from '../audit/audit-event.service.js';
import { AuditAction } from '../audit/enums/audit-action.enum.js';

import { User } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$hashed'),
}));

const { hash: mockHash } = jest.requireMock<{ hash: jest.Mock }>('bcrypt');

describe('UsersService', () => {
  const findOne = jest.fn();
  const create = jest.fn();
  const save = jest.fn();
  const update = jest.fn();
  const usersRepo = { findOne, create, save, update };
  const record = jest.fn();

  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    record.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: AuditEventService, useValue: { record } },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('creates a user with a hashed password', async () => {
      findOne.mockResolvedValue(null);
      create.mockImplementation((data: Partial<User>) => data);
      save.mockImplementation((user: User) =>
        Promise.resolve({ ...user, id: 'user-1' }),
      );

      const result = await service.create({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        password: 'secret',
      });

      expect(mockHash).toHaveBeenCalledWith('secret', 12);
      expect(result.email).toBe('jane@example.com');
      expect(save).toHaveBeenCalled();
    });

    it('throws when email is already in use', async () => {
      findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          password: 'secret',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('returns the user when found', async () => {
      const user = { id: 'user-1', email: 'jane@example.com' };
      findOne.mockResolvedValue(user);

      await expect(service.findById('user-1')).resolves.toEqual(user);
    });

    it('throws when user is not found', async () => {
      findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByEmail', () => {
    it('returns the user when found', async () => {
      const user = { id: 'user-1', email: 'jane@example.com' };
      findOne.mockResolvedValue(user);

      await expect(service.findByEmail('jane@example.com')).resolves.toEqual(
        user,
      );
    });

    it('returns null when not found', async () => {
      findOne.mockResolvedValue(null);

      await expect(
        service.findByEmail('missing@example.com'),
      ).resolves.toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('updates profile fields and saves', async () => {
      const user = {
        id: 'user-1',
        firstName: 'Jane',
        lastName: 'Doe',
        title: null,
        phone: null,
        dateOfBirth: null,
        gender: null,
        jobTitle: null,
        department: null,
        bio: null,
        avatarUrl: null,
        locale: 'en-GB',
        timezone: 'Europe/London',
      };
      findOne.mockResolvedValue(user);
      save.mockImplementation((u: User) => Promise.resolve(u));

      const result = await service.updateProfile('user-1', {
        firstName: ' Janet ',
        jobTitle: ' Coach ',
      });

      expect(result.firstName).toBe('Janet');
      expect(result.jobTitle).toBe('Coach');
      expect(save).toHaveBeenCalledWith(user);
    });
  });

  describe('updateLastLoginAt', () => {
    it('updates lastLoginAt timestamp', async () => {
      update.mockResolvedValue(undefined);

      await service.updateLastLoginAt('user-1');

      expect(update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          lastLoginAt: expect.any(Date) as Date,
        }),
      );
    });

    /**
     * The one write on this entity that is deliberately not evidence. Every
     * sign-in touches it, and the audit table is append-only for seven years,
     * so auditing it would fill the trail an investigator reads with logins.
     * Asserted so that converting it to `save()` breaks a test that says why.
     */
    it('records nothing, deliberately', async () => {
      update.mockResolvedValue(undefined);

      await service.updateLastLoginAt('user-1');

      expect(save).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe('createFromOidc', () => {
    it('creates a verified user with a random password', async () => {
      findOne.mockResolvedValue(null);
      create.mockImplementation((data: Partial<User>) => data);
      save.mockImplementation((user: User) =>
        Promise.resolve({ ...user, id: 'user-2' }),
      );

      const result = await service.createFromOidc({
        firstName: 'Oidc',
        lastName: 'User',
        email: 'oidc@example.com',
      });

      expect(mockHash).toHaveBeenCalled();
      expect(result.isEmailVerified).toBe(true);
    });

    it('throws when email is already in use', async () => {
      findOne.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createFromOidc({
          firstName: 'Oidc',
          lastName: 'User',
          email: 'oidc@example.com',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  /**
   * 6.4 — "name, email, role and MFA changes appear with the acting user".
   *
   * Two mechanisms, because the entity holds both evidence and credentials.
   * A field that is safe to record is loaded and saved, so `AuditLogSubscriber`
   * captures it with a before/after. A credential cannot be recorded at all —
   * `password`, `mfaSecret` and `mfaRecoveryCodes` are excluded from every
   * payload, so a `save()` would diff to nothing and write no row — and the
   * *action* is recorded explicitly instead.
   */
  describe('markEmailVerified', () => {
    it('loads and saves, so the change reaches the subscriber', async () => {
      const user = { id: 'user-1', isEmailVerified: false };
      findOne.mockResolvedValue(user);
      save.mockImplementation((u: User) => Promise.resolve(u));

      await service.markEmailVerified('user-1');

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1', isEmailVerified: true }),
      );
      // Nothing to add: the column diff is the evidence.
      expect(record).not.toHaveBeenCalled();
    });

    it('writes nothing when the address is already verified', async () => {
      findOne.mockResolvedValue({ id: 'user-1', isEmailVerified: true });

      await service.markEmailVerified('user-1');

      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('updatePassword', () => {
    it('hashes and stores the new password', async () => {
      update.mockResolvedValue(undefined);

      await service.updatePassword('user-1', 'new-secret');

      expect(mockHash).toHaveBeenCalledWith('new-secret', 12);
      expect(update).toHaveBeenCalledWith(
        { id: 'user-1' },
        { password: '$2b$12$hashed' },
      );
    });

    /**
     * The second half of the takeover path this coverage exists for: change
     * the address, then reset the password. It must not be the silent half.
     */
    it('records the change as an event, with no payload', async () => {
      update.mockResolvedValue(undefined);

      await service.updatePassword('user-1', 'new-secret');

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.UPDATE,
          entityType: 'users',
          entityId: 'user-1',
          detail: 'Password changed',
        }),
      );
      const [call] = record.mock.calls[0] as [{ changes?: unknown }];
      expect(call.changes).toBeUndefined();
    });
  });

  describe('multi-factor authentication', () => {
    it('records the start of an enrolment, without the secret', async () => {
      update.mockResolvedValue(undefined);

      await service.setPendingMfaSecret('user-1', 'v1:iv:encrypted-secret');

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'users',
          entityId: 'user-1',
          detail: 'Multi-factor authentication enrolment started',
        }),
      );
      expect(JSON.stringify(record.mock.calls[0])).not.toContain(
        'encrypted-secret',
      );
    });

    it('activates through save, so mfaEnabled false to true is audited', async () => {
      const user = { id: 'user-1', mfaEnabled: false, mfaRecoveryCodes: null };
      findOne.mockResolvedValue(user);
      save.mockImplementation((u: User) => Promise.resolve(u));

      await service.enableMfa('user-1', ['$2b$12$one', '$2b$12$two']);

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ mfaEnabled: true }),
      );
      const [saved] = save.mock.calls[0] as [User];
      expect(saved.mfaRecoveryCodes).toEqual(['$2b$12$one', '$2b$12$two']);
    });

    it('deactivates through save, clearing the secret and the codes', async () => {
      const user = {
        id: 'user-1',
        mfaEnabled: true,
        mfaSecret: 'v1:iv:secret',
        mfaRecoveryCodes: ['$2b$12$one'],
      };
      findOne.mockResolvedValue(user);
      save.mockImplementation((u: User) => Promise.resolve(u));

      await service.disableMfa('user-1');

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          mfaEnabled: false,
          mfaSecret: null,
          mfaRecoveryCodes: null,
        }),
      );
    });

    it('records a spent recovery code with the count left, not the codes', async () => {
      update.mockResolvedValue(undefined);

      await service.setMfaRecoveryCodes('user-1', ['$2b$12$left']);

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'users',
          detail: 'Multi-factor recovery code used (1 remaining)',
        }),
      );
      expect(JSON.stringify(record.mock.calls[0])).not.toContain('$2b$12$left');
    });
  });
});
