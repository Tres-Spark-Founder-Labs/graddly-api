import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { InvitationAcceptEmail } from '../email/payloads/invitation-accept.email.js';
import { EnrolmentProvisioningService } from '../enrolments/enrolment-provisioning.service.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { OrganisationRole } from '../organisations/organisation-role.enum.js';
import { PortalType } from '../organisations/portal-type.enum.js';
import { RedisService } from '../redis/redis.service.js';
import { User } from '../users/entities/user.entity.js';

import { Invitation } from './entities/invitation.entity.js';
import { InvitationsService } from './invitations.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

function baseUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    firstName: 'A',
    lastName: 'B',
    email: 'invitee@example.com',
    password: 'x',
    isEmailVerified: true,
    isActive: true,
    avatarUrl: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AuthenticatedUser;
}

describe('InvitationsService', () => {
  let service: InvitationsService;
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getClient: jest.fn(() => ({
      scan: jest.fn().mockResolvedValue(['0', []]),
    })),
  };
  const emailDispatch = { enqueue: jest.fn() };
  const enrolmentProvisioning = { onInvitationAccepted: jest.fn() };
  const portalUrls: Record<string, string> = {
    [PortalType.EMPLOYER]: 'https://employer.graddly.test',
    [PortalType.PROVIDER]: 'https://provider.graddly.test',
    [PortalType.APPRENTICE]: 'https://apprentice.graddly.test',
    [PortalType.FLOW]: 'https://flow.graddly.test',
  };
  const config = {
    get: jest.fn((key: string, def?: unknown) => {
      if (key === 'app.frontend.portalUrls') return portalUrls;
      return def ?? 604_800;
    }),
  };

  let invitationRepo: {
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    softRemove: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let membershipRepo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let organisationRepo: { findOne: jest.Mock };
  let userRepo: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    const transactionMembershipRepo = {
      create: jest.fn(),
      save: jest.fn(),
    };
    const transactionInvitationRepo = {
      save: jest.fn(),
    };

    invitationRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      create: jest.fn().mockImplementation((x: Partial<Invitation>) => ({
        id: 'inv-1',
        ...x,
      })),
      softRemove: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      })),
      manager: {
        transaction: jest.fn(async (fn: (m: unknown) => Promise<void>) => {
          await fn({
            getRepository: (entity: unknown) => {
              if (entity === OrganisationMembership) {
                return transactionMembershipRepo;
              }
              if (entity === Invitation) {
                return transactionInvitationRepo;
              }
              throw new Error('unexpected entity');
            },
          });
        }),
      },
    };

    membershipRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })),
    };

    organisationRepo = { findOne: jest.fn() };

    userRepo = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: ConfigService, useValue: config },
        { provide: RedisService, useValue: redis },
        { provide: EmailDispatchService, useValue: emailDispatch },
        {
          provide: EnrolmentProvisioningService,
          useValue: enrolmentProvisioning,
        },
        { provide: getRepositoryToken(Invitation), useValue: invitationRepo },
        {
          provide: getRepositoryToken(OrganisationMembership),
          useValue: membershipRepo,
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: organisationRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(InvitationsService);
  });

  describe('accept', () => {
    it('throws when token not in redis', async () => {
      redis.get.mockResolvedValue(null);
      await expect(
        service.accept(baseUser(), {
          token: '00000000-0000-4000-8000-000000000001',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws when invitation email does not match user', async () => {
      redis.get.mockResolvedValue('inv-1');
      invitationRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        isDeleted: false,
        email: 'other@example.com',
        expiresAt: new Date(Date.now() + 86_400_000),
        organisation: { id: 'org-1' },
        organisationId: 'org-1',
        role: OrganisationRole.MEMBER,
      });
      await expect(
        service.accept(baseUser(), {
          token: '00000000-0000-4000-8000-000000000001',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws when already a member', async () => {
      redis.get.mockResolvedValue('inv-1');
      invitationRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        isDeleted: false,
        email: 'invitee@example.com',
        expiresAt: new Date(Date.now() + 86_400_000),
        organisation: { id: 'org-1' },
        organisationId: 'org-1',
        role: OrganisationRole.MEMBER,
      });
      membershipRepo.findOne.mockResolvedValue({ id: 'm1' });
      await expect(
        service.accept(baseUser(), {
          token: '00000000-0000-4000-8000-000000000001',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('create', () => {
    function acceptUrlFromLastEmail(): string {
      const calls = emailDispatch.enqueue.mock.calls as unknown[][];
      const payload = calls.at(-1)?.[0];
      expect(payload).toBeInstanceOf(InvitationAcceptEmail);
      return (payload as InvitationAcceptEmail).getTemplateContext()
        .acceptUrl as string;
    }

    beforeEach(() => {
      organisationRepo.findOne.mockResolvedValue({
        id: 'org-1',
        name: 'Acme',
      });
      // The post-send reload used to build the response DTO.
      invitationRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        email: 'new@example.com',
        role: OrganisationRole.MEMBER,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        invitedBy: null,
      });
    });

    it('embeds the frontend URL for the portal type from the header', async () => {
      await service.create(
        baseUser({ organisationId: 'org-1' }),
        { email: 'new@example.com', role: OrganisationRole.MEMBER },
        PortalType.EMPLOYER,
      );

      expect(acceptUrlFromLastEmail()).toContain(
        portalUrls[PortalType.EMPLOYER],
      );
    });

    it('uses the apprentice portal URL when portal type is apprentice', async () => {
      await service.create(
        baseUser({ organisationId: 'org-1' }),
        { email: 'new@example.com', role: OrganisationRole.MEMBER },
        PortalType.APPRENTICE,
      );

      expect(acceptUrlFromLastEmail()).toContain(
        portalUrls[PortalType.APPRENTICE],
      );
    });
  });

  describe('resend', () => {
    it('re-sends invitation email for valid pending invite', async () => {
      invitationRepo.findOne
        .mockResolvedValueOnce({
          id: 'inv-1',
          email: 'new@example.com',
          expiresAt: new Date(Date.now() + 86_400_000),
          organisation: { id: 'org-1', name: 'Acme' },
          invitedBy: null,
        })
        .mockResolvedValueOnce({
          id: 'inv-1',
          email: 'new@example.com',
          role: OrganisationRole.MEMBER,
          expiresAt: new Date(Date.now() + 86_400_000),
          createdAt: new Date(),
          updatedAt: new Date(),
          invitedBy: null,
        });

      const result = await service.resend(
        baseUser({ organisationId: 'org-1' }),
        'inv-1',
        PortalType.EMPLOYER,
      );

      expect(result.id).toBe('inv-1');
      expect(redis.set).toHaveBeenCalled();
      expect(emailDispatch.enqueue).toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('marks invitation deleted and clears accept tokens', async () => {
      const invitation = {
        id: 'inv-1',
        organisation: { id: 'org-1' },
        isDeleted: false,
        deletedAt: null,
      };
      invitationRepo.findOne.mockResolvedValue(invitation);

      await service.revoke(baseUser({ organisationId: 'org-1' }), 'inv-1');

      expect(invitation.isDeleted).toBe(true);
      expect(invitation.deletedAt).toBeInstanceOf(Date);
      expect(invitationRepo.save).toHaveBeenCalledWith(invitation);
    });
  });

  describe('list', () => {
    it('returns paginated rows', async () => {
      const row = {
        id: 'inv-1',
        email: 'x@y.com',
        role: OrganisationRole.MEMBER,
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        invitedBy: null,
      };
      invitationRepo.findAndCount.mockResolvedValue([[row], 1]);
      const res = await service.list(baseUser({ organisationId: 'org-1' }), {
        page: 1,
        perPage: 20,
      });
      expect(res.items).toHaveLength(1);
      expect(res.meta).toMatchObject({ total: 1, page: 1, perPage: 20 });
    });
  });
});
