export interface IEnrolmentPushJobPayload {
  pushId: string;
  organisationId: string;
  requestedByUserId?: string;
}

export interface IEnrolmentPushDlqJobPayload {
  sourceQueue: string;
  sourceJobId: string | undefined;
  pushId: string;
  attemptsMade: number;
  failedAt: string;
  payload: IEnrolmentPushJobPayload;
  errorMessage: string;
}
