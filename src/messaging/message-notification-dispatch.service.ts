import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, Repository } from 'typeorm';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_EMAIL } from '../bullmq/bullmq.constants.js';
import { EMAIL_JOB_SEND } from '../email/email-job.constants.js';
import { EmailPayloadFactory } from '../email/email-payload.factory.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
import { NotificationPreference } from '../notifications/entities/notification-preference.entity.js';
import { NotificationChannel } from '../notifications/enums/notification-channel.enum.js';
import { NotificationType } from '../notifications/enums/notification-type.enum.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { User } from '../users/entities/user.entity.js';

import { MessageThread } from './entities/message-thread.entity.js';
import { MESSAGE_EMAIL_DEBOUNCE_MS } from './messaging.constants.js';

@Injectable()
export class MessageNotificationDispatchService {
  constructor(
    @InjectQueue(QUEUE_EMAIL) private readonly emailQueue: Queue,
    private readonly emailPayloadFactory: EmailPayloadFactory,
    private readonly notificationsService: NotificationsService,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepo: Repository<NotificationPreference>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async notifyNewMessage(input: {
    thread: MessageThread;
    messageId: string;
    senderUserId: string;
    bodyPreview: string;
  }): Promise<void> {
    const recipientUserId = this.recipientUserId(
      input.thread,
      input.senderUserId,
    );
    if (!recipientUserId) {
      return;
    }

    await this.notificationsService.createForUser({
      userId: recipientUserId,
      organisationId: input.thread.organisationId,
      type: NotificationType.MESSAGE,
      title: 'New message',
      body: input.bodyPreview.slice(0, 200),
      metadata: {
        threadId: input.thread.id,
        messageId: input.messageId,
        enrolmentId: input.thread.enrolmentId,
      },
    });

    const emailEnabled = await this.isEmailEnabled(recipientUserId);
    if (!emailEnabled) {
      return;
    }

    const recipient = await this.userRepo.findOne({
      where: { id: recipientUserId },
    });
    if (!recipient?.email) {
      return;
    }

    const payload = new SerializedEmailPayload(
      EmailTemplate.MESSAGE_RECEIVED,
      recipient.email,
      {
        firstName: recipient.firstName,
        messagePreview: input.bodyPreview.slice(0, 200),
        threadId: input.thread.id,
      },
    );
    const data = this.emailPayloadFactory.toJob(payload);
    await this.emailQueue.add(EMAIL_JOB_SEND, data, {
      ...bullmqDefaultJobOptions,
      jobId: `msg-email:${input.thread.id}:${recipientUserId}`,
      delay: MESSAGE_EMAIL_DEBOUNCE_MS,
    });
  }

  private recipientUserId(
    thread: MessageThread,
    senderUserId: string,
  ): string | null {
    if (thread.apprenticeUserId === senderUserId) {
      return thread.counterpartyUserId;
    }
    if (thread.counterpartyUserId === senderUserId) {
      return thread.apprenticeUserId;
    }
    return null;
  }

  private async isEmailEnabled(userId: string): Promise<boolean> {
    const preference = await this.preferenceRepo.findOne({
      where: {
        user: { id: userId },
        organisation: IsNull(),
        type: NotificationType.MESSAGE,
        channel: NotificationChannel.EMAIL,
        isDeleted: false,
      },
    });
    return preference?.enabled ?? true;
  }
}
