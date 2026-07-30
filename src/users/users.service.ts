import { randomBytes } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { User } from './entities/user.entity.js';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(data: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  }): Promise<User> {
    const existing = await this.usersRepository.findOne({
      where: { email: data.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
    const user = this.usersRepository.create({
      ...data,
      password: hashedPassword,
    });
    return this.usersRepository.save(user);
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User not found`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email },
      select: [
        'id',
        'title',
        'firstName',
        'lastName',
        'email',
        'password',
        'isEmailVerified',
        'isActive',
        'avatarUrl',
        'phone',
        'dateOfBirth',
        'gender',
        'jobTitle',
        'department',
        'bio',
        'locale',
        'timezone',
        'lastLoginAt',
        'mfaEnabled',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<User> {
    const user = await this.findById(userId);

    if (dto.title !== undefined) user.title = dto.title;
    if (dto.firstName !== undefined) user.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) user.lastName = dto.lastName.trim();
    if (dto.phone !== undefined) user.phone = dto.phone?.trim() || null;
    if (dto.dateOfBirth !== undefined) user.dateOfBirth = dto.dateOfBirth;
    if (dto.gender !== undefined) user.gender = dto.gender;
    if (dto.jobTitle !== undefined)
      user.jobTitle = dto.jobTitle?.trim() || null;
    if (dto.department !== undefined)
      user.department = dto.department?.trim() || null;
    if (dto.bio !== undefined) user.bio = dto.bio?.trim() || null;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl ?? null;
    if (dto.locale !== undefined) user.locale = dto.locale;
    if (dto.timezone !== undefined) user.timezone = dto.timezone;

    return this.usersRepository.save(user);
  }

  async updateLastLoginAt(userId: string): Promise<void> {
    await this.usersRepository.update(userId, { lastLoginAt: new Date() });
  }

  async createFromOidc(data: {
    firstName: string;
    lastName: string;
    email: string;
  }): Promise<User> {
    const existing = await this.usersRepository.findOne({
      where: { email: data.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const randomPassword = randomBytes(32).toString('base64url');
    const hashedPassword = await bcrypt.hash(randomPassword, SALT_ROUNDS);
    const user = this.usersRepository.create({
      ...data,
      password: hashedPassword,
      isEmailVerified: true,
    });
    return this.usersRepository.save(user);
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.usersRepository.update(
      { id: userId },
      { isEmailVerified: true },
    );
  }

  async updatePassword(userId: string, plainPassword: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    await this.usersRepository.update(
      { id: userId },
      { password: hashedPassword },
    );
  }

  /** Encrypted TOTP secret — `null` when no enrollment (pending or active) exists. */
  async getMfaSecret(userId: string): Promise<string | null> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'mfaSecret'],
    });
    return user?.mfaSecret ?? null;
  }

  /** Stores the encrypted secret for a pending (unconfirmed) enrollment. */
  async setPendingMfaSecret(
    userId: string,
    encryptedSecret: string,
  ): Promise<void> {
    await this.usersRepository.update(
      { id: userId },
      { mfaSecret: encryptedSecret },
    );
  }

  /** Activates MFA after the first code is confirmed, storing the hashed recovery codes. */
  async enableMfa(
    userId: string,
    hashedRecoveryCodes: string[],
  ): Promise<void> {
    await this.usersRepository.update(
      { id: userId },
      { mfaEnabled: true, mfaRecoveryCodes: hashedRecoveryCodes },
    );
  }

  async disableMfa(userId: string): Promise<void> {
    await this.usersRepository.update(
      { id: userId },
      { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null },
    );
  }

  async getMfaRecoveryCodes(userId: string): Promise<string[] | null> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'mfaRecoveryCodes'],
    });
    return user?.mfaRecoveryCodes ?? null;
  }

  async setMfaRecoveryCodes(
    userId: string,
    remainingHashedCodes: string[],
  ): Promise<void> {
    await this.usersRepository.update(
      { id: userId },
      { mfaRecoveryCodes: remainingHashedCodes },
    );
  }
}
