import { BadRequestException } from '@nestjs/common';

import { IlrLearnerRecordStatus } from './enums/ilr-learner-record-status.enum.js';
import { IlrLearnerRecordStatusService } from './ilr-learner-record-status.service.js';

describe('IlrLearnerRecordStatusService', () => {
  const service = new IlrLearnerRecordStatusService();

  it('maps validation success and failure', () => {
    expect(service.applyValidationResult(true)).toBe(
      IlrLearnerRecordStatus.VALIDATED,
    );
    expect(service.applyValidationResult(false)).toBe(
      IlrLearnerRecordStatus.VALIDATION_FAILED,
    );
  });

  it('blocks submit unless validated', () => {
    expect(() => service.assertCanSubmit(IlrLearnerRecordStatus.DRAFT)).toThrow(
      BadRequestException,
    );
    expect(() =>
      service.assertCanSubmit(IlrLearnerRecordStatus.VALIDATED),
    ).not.toThrow();
  });
});
