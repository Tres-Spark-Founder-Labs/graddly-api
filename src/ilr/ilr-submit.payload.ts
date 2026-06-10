export interface IIlrSubmitJobPayload {
  submissionId: string;
  organisationId: string;
  requestedByUserId: string;
}

export interface IIlrSubmitDlqJobPayload {
  sourceQueue: string;
  sourceJobId: string | undefined;
  submissionId: string;
  attemptsMade: number;
  failedAt: string;
  payload: IIlrSubmitJobPayload;
  errorMessage: string;
}
