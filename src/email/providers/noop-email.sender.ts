import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  IEmailMessage,
  IEmailSender,
} from '../interfaces/email-sender.interface.js';

@Injectable()
export class NoopEmailSender implements IEmailSender {
  private readonly logger = new Logger(NoopEmailSender.name);

  constructor(private readonly config: ConfigService) {}

  send(message: IEmailMessage): Promise<void> {
    if (this.config.get<string>('app.nodeEnv') === 'development') {
      this.logger.log(
        [
          `Email (noop): to=${message.to} subject="${message.subject}"`,
          message.text.trim(),
        ].join('\n'),
      );
    }
    return Promise.resolve();
  }
}
