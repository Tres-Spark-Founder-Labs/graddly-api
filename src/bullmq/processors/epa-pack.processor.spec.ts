import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';

import { EpaPackJob } from '../../portfolio/entities/epa-pack-job.entity.js';
import { EpaPackJobStatus } from '../../portfolio/enums/epa-pack-job-status.enum.js';
import { EpaPackBuilderService } from '../../portfolio/epa-pack-builder.service.js';
import { EpaPackEmailService } from '../../portfolio/epa-pack-email.service.js';
import { EPA_PACK_JOB_BUILD } from '../../portfolio/epa-pack.constants.js';
import { StorageKeyBuilder } from '../../storage/storage-key.builder.js';
import { StorageService } from '../../storage/storage.service.js';

import { EpaPackProcessor } from './epa-pack.processor.js';

import type { IEpaPackJobPayload } from '../../portfolio/epa-pack-job.payload.js';

/** F3.3.4 AC5 — the download link is emailed on success, and only then. */
describe('EpaPackProcessor', () => {
  let processor: EpaPackProcessor;
  const update = jest.fn();
  const putObject = jest.fn();
  const buildZipBuffer = jest.fn();
  const sendDownloadLink = jest.fn();

  const job = {
    id: 'job-1',
    name: EPA_PACK_JOB_BUILD,
    data: {
      jobId: 'job-1',
      organisationId: 'org-1',
      userId: 'user-1',
      enrolmentId: 'enrol-1',
    },
  } as Job<IEpaPackJobPayload>;

  beforeEach(async () => {
    jest.clearAllMocks();
    update.mockResolvedValue({ affected: 1 });
    putObject.mockResolvedValue(undefined);
    buildZipBuffer.mockResolvedValue({
      buffer: Buffer.from('PK'),
      manifest: { knowledge: 1 },
    });
    sendDownloadLink.mockResolvedValue('queued');

    const moduleRef = await Test.createTestingModule({
      providers: [
        EpaPackProcessor,
        { provide: EpaPackBuilderService, useValue: { buildZipBuffer } },
        { provide: StorageService, useValue: { putObject } },
        {
          provide: StorageKeyBuilder,
          useValue: {
            build: jest
              .fn()
              .mockReturnValue(
                'orgs/org-1/export/obj/epa-evidence-pack-job-1.zip',
              ),
          },
        },
        { provide: getRepositoryToken(EpaPackJob), useValue: { update } },
        { provide: EpaPackEmailService, useValue: { sendDownloadLink } },
      ],
    }).compile();
    processor = moduleRef.get(EpaPackProcessor);
  });

  it('emails the download link after the job is marked completed', async () => {
    await processor.process(job);

    const statuses = (update.mock.calls as [string, { status: string }][]).map(
      ([, patch]) => patch.status,
    );
    expect(statuses).toEqual([
      EpaPackJobStatus.PROCESSING,
      EpaPackJobStatus.COMPLETED,
    ]);
    expect(sendDownloadLink).toHaveBeenCalledWith('job-1');
    // Completed first, then emailed: the marker's claim needs the status.
    expect(update.mock.invocationCallOrder[1]).toBeLessThan(
      sendDownloadLink.mock.invocationCallOrder[0],
    );
  });

  it('never emails when the build fails', async () => {
    buildZipBuffer.mockRejectedValue(new Error('no accepted evidence'));

    await expect(processor.process(job)).rejects.toThrow(
      'no accepted evidence',
    );

    expect(update).toHaveBeenLastCalledWith('job-1', {
      status: EpaPackJobStatus.FAILED,
      errorMessage: 'no accepted evidence',
    });
    expect(sendDownloadLink).not.toHaveBeenCalled();
  });

  it('keeps the job completed when the email step fails', async () => {
    sendDownloadLink.mockRejectedValue(new Error('S3 unavailable'));

    await expect(processor.process(job)).resolves.toBeUndefined();

    const last = update.mock.calls.at(-1) as [string, { status: string }];
    expect(last[1].status).toBe(EpaPackJobStatus.COMPLETED);
  });
});
