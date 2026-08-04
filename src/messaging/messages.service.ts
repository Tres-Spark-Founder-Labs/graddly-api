import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { buildPaginationMeta } from '../common/pagination/build-pagination-meta.js';
import { PaginatedResult } from '../common/pagination/paginated-result.js';
import { Enrolment } from '../enrolments/entities/enrolment.entity.js';

import { CreateMessageDto } from './dto/create-message.dto.js';
import { MessageAttachmentResponseDto } from './dto/message-attachment-response.dto.js';
import { MessageResponseDto } from './dto/message-response.dto.js';
import { MessageAttachment } from './entities/message-attachment.entity.js';
import { Message } from './entities/message.entity.js';
import { MessageAttachmentsService } from './message-attachments.service.js';
import { MessageNotificationDispatchService } from './message-notification-dispatch.service.js';
import { MessageThreadsService } from './message-threads.service.js';
import { MessagingAccessService } from './messaging-access.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(MessageAttachment)
    private readonly attachmentRepo: Repository<MessageAttachment>,
    @InjectRepository(Enrolment)
    private readonly enrolmentRepo: Repository<Enrolment>,
    private readonly threadsService: MessageThreadsService,
    private readonly accessService: MessagingAccessService,
    private readonly attachmentsService: MessageAttachmentsService,
    private readonly notificationDispatch: MessageNotificationDispatchService,
  ) {}

  async list(
    user: AuthenticatedUser,
    threadId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<MessageResponseDto>> {
    const thread = await this.threadsService.getThreadForMessaging(
      user,
      threadId,
    );
    this.accessService.assertCanRead(thread, user);

    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const [rows, total] = await this.messageRepo.findAndCount({
      where: {
        threadId,
        organisationId: user.organisationId!,
        isDeleted: false,
      },
      relations: ['attachments'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * perPage,
      take: perPage,
    });

    return new PaginatedResult(
      rows.map((row) => this.toResponse(row)),
      buildPaginationMeta({ total, page, perPage }),
    );
  }

  async create(
    user: AuthenticatedUser,
    threadId: string,
    dto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    const thread = await this.threadsService.getThreadForMessaging(
      user,
      threadId,
    );
    this.accessService.assertCanWrite(thread, user);

    if (dto.attachments?.length) {
      for (const attachment of dto.attachments) {
        this.attachmentsService.assertAttachmentStorageKey(
          thread.organisationId,
          thread.apprenticeId,
          attachment.storageKey,
        );
        this.attachmentsService.assertAttachmentMetadata(
          attachment.contentType,
          attachment.contentLength,
        );
      }
    }

    const message = await this.messageRepo.save(
      this.messageRepo.create({
        organisationId: thread.organisationId,
        threadId: thread.id,
        senderUserId: user.id,
        body: dto.body,
      }),
    );

    if (dto.attachments?.length) {
      const attachmentRows = dto.attachments.map((attachment) =>
        this.attachmentRepo.create({
          organisationId: thread.organisationId,
          messageId: message.id,
          storageKey: attachment.storageKey,
          filename: attachment.filename,
          contentType: attachment.contentType,
          contentLength: attachment.contentLength,
        }),
      );
      await this.attachmentRepo.save(attachmentRows);
      message.attachments = attachmentRows;
    } else {
      message.attachments = [];
    }

    await this.notificationDispatch.notifyNewMessage({
      thread,
      messageId: message.id,
      senderUserId: user.id,
      bodyPreview: dto.body,
    });

    return this.toResponse(message);
  }

  async provisionThreadsForEnrolment(enrolmentId: string): Promise<void> {
    const enrolment = await this.enrolmentRepo.findOne({
      where: { id: enrolmentId, isDeleted: false },
    });
    if (!enrolment) {
      throw new NotFoundException('Enrolment not found');
    }
    await this.threadsService.ensureThreadsForEnrolment(enrolment);
  }

  private toResponse(message: Message): MessageResponseDto {
    const attachments: MessageAttachmentResponseDto[] = (
      message.attachments ?? []
    ).map((attachment) => ({
      id: attachment.id,
      storageKey: attachment.storageKey,
      filename: attachment.filename,
      contentType: attachment.contentType,
      contentLength: attachment.contentLength,
    }));

    return {
      id: message.id,
      threadId: message.threadId,
      senderUserId: message.senderUserId,
      body: message.body,
      attachments,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
