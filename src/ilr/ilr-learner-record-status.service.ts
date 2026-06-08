import { BadRequestException, Injectable } from '@nestjs/common';

import { IlrLearnerRecordStatus } from './enums/ilr-learner-record-status.enum.js';

@Injectable()
export class IlrLearnerRecordStatusService {
  applyValidationResult(isValid: boolean): IlrLearnerRecordStatus {
    return isValid
      ? IlrLearnerRecordStatus.VALIDATED
      : IlrLearnerRecordStatus.VALIDATION_FAILED;
  }

  assertCanSubmit(status: IlrLearnerRecordStatus): void {
    if (status !== IlrLearnerRecordStatus.VALIDATED) {
      throw new BadRequestException(
        'ILR learner record must be validated before submission',
      );
    }
  }

  resetToDraft(): IlrLearnerRecordStatus {
    return IlrLearnerRecordStatus.DRAFT;
  }
}
