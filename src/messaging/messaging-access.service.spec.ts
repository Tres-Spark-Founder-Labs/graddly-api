import { ForbiddenException } from '@nestjs/common';

import { MessageThread } from './entities/message-thread.entity.js';
import { MessageThreadParty } from './enums/message-thread-party.enum.js';
import { MessagingAccessService } from './messaging-access.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

describe('MessagingAccessService', () => {
  let service: MessagingAccessService;

  const thread: MessageThread = {
    id: 't-1',
    organisationId: 'org-1',
    enrolmentId: 'e-1',
    apprenticeId: 'a-1',
    counterpartyParty: MessageThreadParty.TUTOR,
    apprenticeUserId: 'u-app',
    counterpartyUserId: 'u-tutor',
    archivedAt: null,
  } as MessageThread;

  beforeEach(() => {
    service = new MessagingAccessService();
  });

  it('identifies admin users', () => {
    const admin = { id: 'u-admin', roles: ['admin'] } as AuthenticatedUser;
    expect(service.isAdmin(admin)).toBe(true);
  });

  it('allows participants to read', () => {
    const apprentice = { id: 'u-app', roles: ['member'] } as AuthenticatedUser;
    expect(service.canRead(thread, apprentice)).toBe(true);
  });

  it('denies strangers read access', () => {
    const stranger = { id: 'u-x', roles: ['member'] } as AuthenticatedUser;
    expect(() => service.assertCanRead(thread, stranger)).toThrow(
      ForbiddenException,
    );
  });

  it('rejects writes on archived threads', () => {
    const archived = { ...thread, archivedAt: new Date() } as MessageThread;
    const apprentice = { id: 'u-app', roles: ['member'] } as AuthenticatedUser;
    expect(() => service.assertCanWrite(archived, apprentice)).toThrow(
      'archived',
    );
  });

  it('identifies thread participants by user id', () => {
    expect(service.isParticipant(thread, 'u-app')).toBe(true);
    expect(service.isParticipant(thread, 'u-stranger')).toBe(false);
  });

  it('allows counterparty to write', () => {
    const tutor = { id: 'u-tutor', roles: ['member'] } as AuthenticatedUser;
    expect(() => service.assertCanWrite(thread, tutor)).not.toThrow();
  });
});
