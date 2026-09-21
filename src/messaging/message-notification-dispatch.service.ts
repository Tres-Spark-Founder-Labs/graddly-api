import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import { bullmqDefaultJobOptions } from '../bullmq/bullmq-default-job-options.js';
import { QUEUE_EMAIL } from '../bullmq/bullmq.constants.js';
import { EMAIL_JOB_SEND } from '../email/email-job.constants.js';
import { EmailPayloadFactory } from '../email/email-payload.factory.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';
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

    /**
     * The send-time preference check (F3.4.3 AC3). This used to read the
     * recipient's preference row itself — as the sender, under
     * `notification_preferences_select`, which admits only the row's own
     * user. The recipient's row was therefore always invisible, `?? true`
     * answered "enabled", and a recipient who had switched message emails off
     * kept receiving them. The check now reads past that to the recipient's
     * own setting; see `NotificationsService.isEmailEnabled`.
     *
     * Called directly rather than through `sendEmail` because this email is
     * enqueued with its own job id and delay (the debounce below).
     */
    const emailEnabled = await this.notificationsService.isEmailEnabled(
      recipientUserId,
      NotificationType.MESSAGE,
    );
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
}
