/**
 * Deterministic fake ESFA submit client for e2e/local dev.
 * Receipt shape is NOT a spec of real ESFA responses — update when sandbox contract is confirmed.
 */
import { createHash } from 'crypto';

import { Injectable } from '@nestjs/common';

import type {
  IIlrEsfaClient,
  IIlrEsfaSubmitRequest,
  IIlrEsfaSubmitResult,
} from './interfaces/ilr-esfa.client.interface.js';

@Injectable()
export class IlrEsfaNoopClient implements IIlrEsfaClient {
  submit(request: IIlrEsfaSubmitRequest): Promise<IIlrEsfaSubmitResult> {
    const digest = createHash('sha256')
      .update(request.learnerRecordId)
      .update(request.isAmendment ? 'amend' : 'submit')
      .update(request.priorEsfaReference ?? '')
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();

    const esfaReference = `NOOP-${digest}`;
    const receipt: Record<string, unknown> = {
      provider: 'noop',
      esfaReference,
      submissionId: esfaReference,
      status: 'accepted',
      isAmendment: request.isAmendment,
      receivedAt: new Date().toISOString(),
      ukprn: request.ukprn,
      collectionPeriod: request.collectionPeriod,
    };

    return Promise.resolve({ esfaReference, receipt });
  }
}
