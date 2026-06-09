import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

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

  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('creates a user with a hashed password', async () => {
      findOne.mockResolvedValue(null);
      create.mockImplementation((data: Partial<User>) => data);
      save.mockImplementation((user: User) =>
        Promise.resolve({ id: 'user-1', ...user }),
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
  });

  describe('createFromOidc', () => {
    it('creates a verified user with a random password', async () => {
      findOne.mockResolvedValue(null);
      create.mockImplementation((data: Partial<User>) => data);
      save.mockImplementation((user: User) =>
        Promise.resolve({ id: 'user-2', ...user }),
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

  describe('markEmailVerified', () => {
    it('sets isEmailVerified to true', async () => {
      update.mockResolvedValue(undefined);

      await service.markEmailVerified('user-1');

      expect(update).toHaveBeenCalledWith(
        { id: 'user-1' },
        { isEmailVerified: true },
      );
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
  });
});
