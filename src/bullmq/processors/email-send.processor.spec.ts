import { Test, TestingModule } from '@nestjs/testing';

import { EMAIL_JOB_SEND } from '../../email/email-job.constants.js';
import { EmailPayloadFactory } from '../../email/email-payload.factory.js';
import { EmailTemplate } from '../../email/email-template.enum.js';
import { EmailService } from '../../email/email.service.js';
import { SerializedEmailPayload } from '../../email/payloads/serialized-email.payload.js';

import { EmailSendProcessor } from './email-send.processor.js';

import type { IEmailJobPayload } from '../../email/email-job.payload.js';
import type { Job } from 'bullmq';

describe('EmailSendProcessor', () => {
  let processor: EmailSendProcessor;
  const emailService = { sendEmail: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    emailService.sendEmail.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailSendProcessor,
        EmailPayloadFactory,
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    processor = module.get(EmailSendProcessor);
  });

  it('sends email for send jobs', async () => {
    const job = {
      id: '1',
      name: EMAIL_JOB_SEND,
      data: {
        template: EmailTemplate.INVITATION_ACCEPT,
        to: 'invitee@example.com',
        context: { firstName: 'Sam' },
      },
    } as unknown as Job<IEmailJobPayload>;

    await processor.process(job);

    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.any(SerializedEmailPayload),
    );
  });

  it('ignores unknown job names', async () => {
    const job = {
      id: '2',
      name: 'unknown',
      data: {} as IEmailJobPayload,
    } as unknown as Job<IEmailJobPayload>;

    await processor.process(job);

    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });
});
