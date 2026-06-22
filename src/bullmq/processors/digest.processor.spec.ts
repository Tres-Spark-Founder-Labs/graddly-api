import { Test } from '@nestjs/testing';

import { OtjDigestService } from '../../notifications/otj-digest.service.js';
import { DIGEST_JOB_WEEKLY_OTJ } from '../bullmq.constants.js';

import { DigestProcessor } from './digest.processor.js';

import type { IWeeklyOtjDigestJobPayload } from '../../notifications/digest-job.payload.js';
import type { Job } from 'bullmq';

describe('DigestProcessor', () => {
  let processor: DigestProcessor;
  const sendWeeklyDigestForOrganisation = jest.fn();

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DigestProcessor,
        {
          provide: OtjDigestService,
          useValue: { sendWeeklyDigestForOrganisation },
        },
      ],
    }).compile();

    processor = moduleRef.get(DigestProcessor);
    jest.clearAllMocks();
    sendWeeklyDigestForOrganisation.mockResolvedValue(1);
  });

  it('delegates weekly OTJ digest jobs to OtjDigestService', async () => {
    const job = {
      id: '1',
      name: DIGEST_JOB_WEEKLY_OTJ,
      data: { organisationId: 'org-1' },
    } as Job<IWeeklyOtjDigestJobPayload>;

    await processor.process(job);

    expect(sendWeeklyDigestForOrganisation).toHaveBeenCalledWith('org-1');
  });
});
