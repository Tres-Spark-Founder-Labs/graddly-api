import { Injectable } from '@nestjs/common';

import { EmailDispatchService } from '../email/email-dispatch.service.js';
import { EmailTemplate } from '../email/email-template.enum.js';
import { SerializedEmailPayload } from '../email/payloads/serialized-email.payload.js';

@Injectable()
export class RegistrationEmailService {
  constructor(private readonly emailDispatch: EmailDispatchService) {}

  async sendCompletionEmail(input: {
    to: string;
    companyName: string | null;
    sessionId: string;
  }): Promise<void> {
    await this.emailDispatch.enqueue(
      new SerializedEmailPayload(
        EmailTemplate.FLOWPORTAL_REGISTRATION_COMPLETE,
        input.to,
        {
          companyName: input.companyName ?? 'your organisation',
          sessionId: input.sessionId,
        },
      ),
    );
  }
}
