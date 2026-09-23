import { randomBytes } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { AuditEventService } from '../audit/audit-event.service.js';
import { AuditAction } from '../audit/enums/audit-action.enum.js';
import {
  getCurrentOrganisationId,
  getCurrentUserId,
} from '../common/context/correlation-id-context.js';

import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { User } from './entities/user.entity.js';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly auditEvents: AuditEventService,
  ) {}

  /**
   * Records an account-security action the subscriber cannot see.
   *
   * ── WHY THESE ARE EXPLICIT EVENTS AND NOT `save()` CALLS ────────────────────
   *
   * `AuditLogSubscriber` writes a row only when the change payload is
   * non-empty, and `password`, `mfaSecret` and `mfaRecoveryCodes` are excluded
   * from every payload — they must never enter a table that is append-only for
   * seven years. So a credential write has nothing left to diff: converting it
   * to `save()` would produce an empty change set and no row at all, which is
   * how it would look like coverage and be silence.
   *
   * The action itself is the evidence here, not the value. These rows say that
   * a password was changed or an authenticator enrolled, by whom and when,
   * with no payload — which is exactly what an account-takeover investigation
   * reads. F3.4.3-style column diffs are the subscriber's job; this is the
   * pattern `erasure.service.ts` already uses for the same reason.
   *
   * The organisation follows the same rule as the `users` branch of
   * `resolveAuditOrganisationId`: the acting organisation, or null at the
   * platform level (a password reset arrives on a token, with no organisation
   * and no session). Null rows are readable under `app_rls_bootstrap()`.
   */
  private async recordAccountSecurityEvent(
    userId: string,
    detail: string,
  ): Promise<void> {
    await this.auditEvents.record({
      user: { id: getCurrentUserId() ?? null },
      action: AuditAction.UPDATE,
      entityType: 'users',
      entityId: userId,
      organisationId: getCurrentOrganisationId() ?? null,
      detail,
    });
  }

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

  /**
   * Deliberately stays a bulk `update()`, and so deliberately produces no
   * audit row.
   *
   * This is the one write on this entity that is not evidence of a decision.
   * Every successful sign-in touches it, so auditing it would add a row per
   * login per user to a table that is append-only and kept for seven years —
   * and the trail an investigator reads would be mostly logins. The
   * information is not lost: `lastLoginAt` itself is the current answer, and
   * sign-in activity belongs in the authentication logs rather than in the
   * evidence trail.
   *
   * Switching this to `save()` would change that, silently. It is an
   * exclusion, not an oversight.
   */
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

  /**
   * Loaded and saved rather than bulk-updated, so the subscriber records
   * `isEmailVerified` moving false → true with the acting user against it.
   * Every caller has already established that the user exists (a verified
   * token, or a lookup by email), so the `findById` throw is unreachable in
   * practice and correct if it ever is not.
   */
  async markEmailVerified(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (user.isEmailVerified) {
      return;
    }
    user.isEmailVerified = true;
    await this.usersRepository.save(user);
  }

  /**
   * The hash is written with `update()` on purpose: it is excluded from audit
   * payloads, so a `save()` would diff to nothing and write no row. The fact
   * of the change is recorded explicitly instead — the takeover path this
   * audit coverage exists for is "change the address, then reset the
   * password", and the reset must not be the silent half of it.
   */
  async updatePassword(userId: string, plainPassword: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(plainPassword, SALT_ROUNDS);
    await this.usersRepository.update(
      { id: userId },
      { password: hashedPassword },
    );
    await this.recordAccountSecurityEvent(userId, 'Password changed');
  }

  /** Encrypted TOTP secret — `null` when no enrollment (pending or active) exists. */
  async getMfaSecret(userId: string): Promise<string | null> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'mfaSecret'],
    });
    return user?.mfaSecret ?? null;
  }

  /**
   * Stores the encrypted secret for a pending (unconfirmed) enrollment.
   *
   * The secret is excluded from audit payloads, so the enrolment is recorded
   * as an event. It matters on its own: an enrolment that starts and never
   * completes is what an attacker adding their own authenticator looks like.
   */
  async setPendingMfaSecret(
    userId: string,
    encryptedSecret: string,
  ): Promise<void> {
    await this.usersRepository.update(
      { id: userId },
      { mfaSecret: encryptedSecret },
    );
    await this.recordAccountSecurityEvent(
      userId,
      'Multi-factor authentication enrolment started',
    );
  }

  /**
   * Activates MFA after the first code is confirmed, storing the hashed
   * recovery codes.
   *
   * Loaded and saved so the subscriber records `mfaEnabled` false → true with
   * the acting user. The recovery codes ride along in the same statement and
   * stay out of the payload, where they belong.
   */
  async enableMfa(
    userId: string,
    hashedRecoveryCodes: string[],
  ): Promise<void> {
    const user = await this.findById(userId);
    user.mfaEnabled = true;
    user.mfaRecoveryCodes = hashedRecoveryCodes;
    await this.usersRepository.save(user);
  }

  /** Audited through `mfaEnabled` true → false, as `enableMfa` is. */
  async disableMfa(userId: string): Promise<void> {
    const user = await this.findById(userId);
    user.mfaEnabled = false;
    user.mfaSecret = null;
    user.mfaRecoveryCodes = null;
    await this.usersRepository.save(user);
  }

  async getMfaRecoveryCodes(userId: string): Promise<string[] | null> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: ['id', 'mfaRecoveryCodes'],
    });
    return user?.mfaRecoveryCodes ?? null;
  }

  /**
   * Called when a recovery code has been spent, with the remaining hashes.
   *
   * Recorded as an event with the count left rather than the codes, because
   * bypassing MFA with a recovery code is the step someone takes when they do
   * not have the authenticator — which is either a locked-out learner or
   * somebody else holding their codes. The trail should show it happened.
   */
  async setMfaRecoveryCodes(
    userId: string,
    remainingHashedCodes: string[],
  ): Promise<void> {
    await this.usersRepository.update(
      { id: userId },
      { mfaRecoveryCodes: remainingHashedCodes },
    );
    await this.recordAccountSecurityEvent(
      userId,
      `Multi-factor recovery code used (${remainingHashedCodes.length} remaining)`,
    );
  }
}
