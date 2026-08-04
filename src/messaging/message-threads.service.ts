import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';
import { User } from '../users/entities/user.entity.js';

import { ListMessageThreadsQueryDto } from './dto/list-message-threads-query.dto.js';
import { MessageThreadResponseDto } from './dto/message-thread-response.dto.js';
import { MessageThreadSummaryDto } from './dto/message-thread-summary.dto.js';
import { MessagingUnreadCountResponseDto } from './dto/messaging-unread-count-response.dto.js';
import { MessageThreadRead } from './entities/message-thread-read.entity.js';
import { MessageThread } from './entities/message-thread.entity.js';
import { Message } from './entities/message.entity.js';
import { MessageThreadParty } from './enums/message-thread-party.enum.js';
import { MessagingAccessService } from './messaging-access.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

const PREVIEW_MAX_LENGTH = 160;

/**
 * Long enough to recognise which conversation this is, short enough that a
 * profile carrying two of them is not carrying two whole messages. The ellipsis
 * is part of the contract: a caller must be able to tell a truncated preview
 * from a short message, or it will render half a sentence as the whole one.
 */
function buildPreview(body: string): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  return collapsed.length > PREVIEW_MAX_LENGTH
    ? `${collapsed.slice(0, PREVIEW_MAX_LENGTH).trimEnd()}…`
    : collapsed;
}

@Injectable()
export class MessageThreadsService {
  constructor(
    @InjectRepository(MessageThread)
    private readonly threadRepo: Repository<MessageThread>,
    @InjectRepository(MessageThreadRead)
    private readonly readRepo: Repository<MessageThreadRead>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly accessService: MessagingAccessService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListMessageThreadsQueryDto,
  ): Promise<MessageThreadResponseDto[]> {
    const organisationId = user.organisationId!;

    if (query.enrolmentId) {
      const enrolment = await this.enrolmentRepo.findOne({
        where: {
          id: query.enrolmentId,
          organisationId,
          isDeleted: false,
        },
      });
      if (enrolment) {
        await this.ensureThreadsForEnrolment(enrolment);
      }
    }

    /**
     * Owner OR participant — see `visibleThreadWhere`. Written out here
     * because this path uses a QueryBuilder for its optional filters; the
     * bracketing matters, since `A OR B AND C` would silently drop the
     * isDeleted guard from the first arm.
     */
    const qb = this.threadRepo
      .createQueryBuilder('t')
      .where(
        '(t.organisationId = :organisationId OR t.apprenticeUserId = :userId OR t.counterpartyUserId = :userId)',
        { organisationId, userId: user.id },
      )
      .andWhere('t.isDeleted = false');

    if (query.enrolmentId) {
      qb.andWhere('t.enrolmentId = :enrolmentId', {
        enrolmentId: query.enrolmentId,
      });
    }
    if (query.apprenticeId) {
      qb.andWhere('t.apprenticeId = :apprenticeId', {
        apprenticeId: query.apprenticeId,
      });
    }

    qb.orderBy('t.createdAt', 'ASC');
    const threads = await qb.getMany();

    const accessible = threads.filter((thread) =>
      this.accessService.canRead(thread, user),
    );

    return Promise.all(
      accessible.map((thread) => this.toResponse(thread, user.id)),
    );
  }

  /**
   * F2.2.4 AC5 — the learner profile's communication panel.
   *
   * The profile used to return a bare array of thread UUIDs. Nothing could be
   * rendered from that: no name, no date, no preview, no unread count. It was
   * a door with no handle — the data existed, the screen could not open it.
   *
   * Kept here rather than in the profile service because messaging owns what a
   * thread means; the profile just embeds the answer. Unread and last-message
   * lookups run per thread, which is safe because the unique index on
   * (enrolmentId, counterpartyParty) caps an enrolment at two threads — one
   * for the tutor, one for the employer manager.
   */
  async listSummariesForEnrolment(
    user: AuthenticatedUser,
    enrolmentId: string,
  ): Promise<MessageThreadSummaryDto[]> {
    const threads = await this.threadRepo.find({
      where: this.visibleThreadWhere(user, { enrolmentId }),
      order: { createdAt: 'ASC' },
    });

    const accessible = threads.filter((thread) =>
      this.accessService.canRead(thread, user),
    );
    if (accessible.length === 0) {
      return [];
    }

    const counterparties = await this.userRepo.find({
      where: { id: In(accessible.map((t) => t.counterpartyUserId)) },
      select: ['id', 'firstName', 'lastName'],
    });
    const nameById = new Map(
      counterparties.map((u) => [
        u.id,
        `${u.firstName} ${u.lastName}`.trim() || null,
      ]),
    );

    return Promise.all(
      accessible.map(async (thread) => {
        const [lastMessage, messageCount, unreadCount] = await Promise.all([
          this.messageRepo.findOne({
            where: { threadId: thread.id, isDeleted: false },
            order: { createdAt: 'DESC' },
          }),
          this.messageRepo.count({
            where: { threadId: thread.id, isDeleted: false },
          }),
          this.countUnreadForUser(thread, user.id),
        ]);

        return {
          id: thread.id,
          counterpartyParty: thread.counterpartyParty,
          counterpartyUserId: thread.counterpartyUserId,
          counterpartyName: nameById.get(thread.counterpartyUserId) ?? null,
          messageCount,
          unreadCount,
          lastMessageAt: lastMessage?.createdAt.toISOString() ?? null,
          lastMessagePreview: lastMessage
            ? buildPreview(lastMessage.body)
            : null,
          lastMessageSenderUserId: lastMessage?.senderUserId ?? null,
          archivedAt: thread.archivedAt?.toISOString() ?? null,
        };
      }),
    );
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<MessageThreadResponseDto> {
    const thread = await this.getThreadOrThrow(user, id);
    this.accessService.assertCanRead(thread, user);
    return this.toResponse(thread, user.id);
  }

  /**
   * Security hardening pass, item 1 — the query half of the linked-party fix.
   *
   * Every thread read used to be `WHERE organisationId = :caller`. A thread is
   * stamped with the enrolment's owning organisation, but its counterparty is
   * frequently an employer manager whose active organisation is the employer —
   * so the owner-scoped clause threw their own threads away, and their inbox
   * was empty.
   *
   * Opening the RLS policy alone would not have fixed this. The implementation
   * log records the same two-layer failure on `otj_log_entries` in F1.4.2,
   * where the database was already willing to return the rows and the service
   * discarded them anyway.
   *
   * Returns an OR of three shapes: the owning organisation (unchanged, so
   * provider admins keep working), plus either participant by user id —
   * matching `MessagingAccessService.isParticipant`, which is the rule that
   * actually decides access.
   */
  private visibleThreadWhere(
    user: AuthenticatedUser,
    extra: Partial<FindOptionsWhere<MessageThread>> = {},
  ): FindOptionsWhere<MessageThread>[] {
    const base = { ...extra, isDeleted: false as const };
    return [
      { ...base, organisationId: user.organisationId! },
      { ...base, apprenticeUserId: user.id },
      { ...base, counterpartyUserId: user.id },
    ];
  }

  async getUnreadCount(
    user: AuthenticatedUser,
  ): Promise<MessagingUnreadCountResponseDto> {
    const threads = await this.threadRepo.find({
      where: this.visibleThreadWhere(user),
    });
    const accessible = threads.filter((thread) =>
      this.accessService.canRead(thread, user),
    );

    let unreadCount = 0;
    for (const thread of accessible) {
      unreadCount += await this.countUnreadForUser(thread, user.id);
    }

    return { unreadCount };
  }

  async markRead(user: AuthenticatedUser, threadId: string): Promise<void> {
    const thread = await this.getThreadOrThrow(user, threadId);
    this.accessService.assertCanRead(thread, user);

    const existing = await this.readRepo.findOne({
      where: { threadId, userId: user.id },
    });
    const now = new Date();
    if (existing) {
      existing.lastReadAt = now;
      await this.readRepo.save(existing);
      return;
    }

    await this.readRepo.save(
      this.readRepo.create({
        organisationId: thread.organisationId,
        threadId: thread.id,
        userId: user.id,
        lastReadAt: now,
      }),
    );
  }

  async archiveForEnrolment(enrolmentId: string): Promise<void> {
    const threads = await this.threadRepo.find({
      where: { enrolmentId, isDeleted: false },
    });
    const now = new Date();
    for (const thread of threads) {
      if (!thread.archivedAt) {
        thread.archivedAt = now;
        await this.threadRepo.save(thread);
      }
    }
  }

  async ensureThreadsForEnrolment(enrolment: Enrolment): Promise<void> {
    if (
      !enrolment.apprenticeUserId ||
      !enrolment.tutorUserId ||
      !enrolment.employerManagerUserId
    ) {
      return;
    }

    if (
      enrolment.status !== EnrolmentStatus.ACTIVE &&
      enrolment.status !== EnrolmentStatus.COMPLETED
    ) {
      return;
    }

    await this.ensureThread(
      enrolment,
      MessageThreadParty.TUTOR,
      enrolment.tutorUserId,
    );
    await this.ensureThread(
      enrolment,
      MessageThreadParty.EMPLOYER_MANAGER,
      enrolment.employerManagerUserId,
    );
  }

  /**
   * Takes the user, not an organisation id, for the same reason as
   * `getThreadOrThrow`: the sender of a message is routinely the employer
   * counterparty, whose active organisation does not own the thread.
   */
  async getThreadForMessaging(
    user: AuthenticatedUser,
    threadId: string,
  ): Promise<MessageThread> {
    return this.getThreadOrThrow(user, threadId);
  }

  private async ensureThread(
    enrolment: Enrolment,
    party: MessageThreadParty,
    counterpartyUserId: string,
  ): Promise<MessageThread> {
    const existing = await this.threadRepo.findOne({
      where: {
        enrolmentId: enrolment.id,
        counterpartyParty: party,
        isDeleted: false,
      },
    });
    if (existing) {
      return existing;
    }

    return this.threadRepo.save(
      this.threadRepo.create({
        organisationId: enrolment.organisationId,
        enrolmentId: enrolment.id,
        apprenticeId: enrolment.apprenticeId,
        counterpartyParty: party,
        apprenticeUserId: enrolment.apprenticeUserId!,
        counterpartyUserId,
        archivedAt:
          enrolment.status === EnrolmentStatus.COMPLETED ? new Date() : null,
      }),
    );
  }

  private async getThreadOrThrow(
    user: AuthenticatedUser,
    id: string,
  ): Promise<MessageThread> {
    // Owner OR participant. Scoping this to the owning organisation alone
    // gave the employer counterparty a 404 on their own thread.
    const thread = await this.threadRepo.findOne({
      where: this.visibleThreadWhere(user, { id }),
    });
    if (!thread) {
      throw new NotFoundException('Message thread not found');
    }
    return thread;
  }

  private async countUnreadForUser(
    thread: MessageThread,
    userId: string,
  ): Promise<number> {
    const read = await this.readRepo.findOne({
      where: { threadId: thread.id, userId },
    });
    const lastReadAt = read?.lastReadAt ?? new Date(0);

    return this.messageRepo
      .createQueryBuilder('m')
      .where('m.threadId = :threadId', { threadId: thread.id })
      .andWhere('m.isDeleted = false')
      .andWhere('m.senderUserId != :userId', { userId })
      .andWhere('m.createdAt > :lastReadAt', { lastReadAt })
      .getCount();
  }

  private async toResponse(
    thread: MessageThread,
    userId: string,
  ): Promise<MessageThreadResponseDto> {
    return {
      id: thread.id,
      organisationId: thread.organisationId,
      enrolmentId: thread.enrolmentId,
      apprenticeId: thread.apprenticeId,
      counterpartyParty: thread.counterpartyParty,
      apprenticeUserId: thread.apprenticeUserId,
      counterpartyUserId: thread.counterpartyUserId,
      archivedAt: thread.archivedAt?.toISOString() ?? null,
      unreadCount: await this.countUnreadForUser(thread, userId),
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    };
  }
}
