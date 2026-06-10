export interface ICompletionPushJobPayload {
  pushId: string;
  organisationId: string;
  requestedByUserId?: string;
}

export interface ICompletionPushDlqJobPayload {
  sourceQueue: string;
  sourceJobId: string | undefined;
  pushId: string;
  attemptsMade: number;
  failedAt: string;
  payload: ICompletionPushJobPayload;
  errorMessage: string;
}
