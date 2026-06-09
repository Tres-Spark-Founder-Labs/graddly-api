import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Enrolment } from '../enrolments/entities/enrolment.entity.js';
import { EnrolmentStatus } from '../enrolments/enums/enrolment-status.enum.js';

import { ListMessageThreadsQueryDto } from './dto/list-message-threads-query.dto.js';
import { MessageThreadResponseDto } from './dto/message-thread-response.dto.js';
import { MessagingUnreadCountResponseDto } from './dto/messaging-unread-count-response.dto.js';
import { MessageThreadRead } from './entities/message-thread-read.entity.js';
import { MessageThread } from './entities/message-thread.entity.js';
import { Message } from './entities/message.entity.js';
import { MessageThreadParty } from './enums/message-thread-party.enum.js';
import { MessagingAccessService } from './messaging-access.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

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

    const qb = this.threadRepo
      .createQueryBuilder('t')
      .where('t.organisationId = :organisationId', { organisationId })
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

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<MessageThreadResponseDto> {
    const thread = await this.getThreadOrThrow(user.organisationId!, id);
    this.accessService.assertCanRead(thread, user);
    return this.toResponse(thread, user.id);
  }

  async getUnreadCount(
    user: AuthenticatedUser,
  ): Promise<MessagingUnreadCountResponseDto> {
    const threads = await this.threadRepo.find({
      where: { organisationId: user.organisationId!, isDeleted: false },
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
    const thread = await this.getThreadOrThrow(user.organisationId!, threadId);
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

  async getThreadForMessaging(
    organisationId: string,
    threadId: string,
  ): Promise<MessageThread> {
    return this.getThreadOrThrow(organisationId, threadId);
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
    organisationId: string,
    id: string,
  ): Promise<MessageThread> {
    const thread = await this.threadRepo.findOne({
      where: { id, organisationId, isDeleted: false },
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
