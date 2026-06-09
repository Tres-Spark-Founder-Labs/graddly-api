import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import { MessageThread } from './entities/message-thread.entity.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class MessagingAccessService {
  isAdmin(user: AuthenticatedUser): boolean {
    const roles = user.roles ?? [];
    return (
      roles.includes(OrganisationRole.OWNER) ||
      roles.includes(OrganisationRole.ADMIN)
    );
  }

  isParticipant(thread: MessageThread, userId: string): boolean {
    return (
      thread.apprenticeUserId === userId || thread.counterpartyUserId === userId
    );
  }

  canRead(thread: MessageThread, user: AuthenticatedUser): boolean {
    return this.isAdmin(user) || this.isParticipant(thread, user.id);
  }

  assertCanRead(thread: MessageThread, user: AuthenticatedUser): void {
    if (!this.canRead(thread, user)) {
      throw new ForbiddenException('You do not have access to this thread');
    }
  }

  assertCanWrite(thread: MessageThread, user: AuthenticatedUser): void {
    if (thread.archivedAt) {
      throw new BadRequestException(
        'This thread is archived and no longer accepts messages',
      );
    }
    if (!this.isParticipant(thread, user.id)) {
      throw new ForbiddenException('You cannot send messages in this thread');
    }
  }
}
