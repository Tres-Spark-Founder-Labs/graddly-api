/**
 * v1 assumes a configurable REST submit endpoint (see IlrEsfaHttpClient).
 * Official ESFA ILR returns use XML via Submit Learner Data — submit()/amend()
 * may later wrap XML upload or portal automation without changing callers.
 */
export interface IIlrEsfaSubmitRequest {
  organisationId: string;
  ukprn: string;
  collectionPeriod: string;
  academicYear: string;
  fields: Record<string, Record<string, string | null>>;
  isAmendment: boolean;
  priorEsfaReference?: string | null;
  learnerRecordId: string;
}

export interface IIlrEsfaSubmitResult {
  esfaReference: string;
  receipt: Record<string, unknown>;
}

export interface IIlrEsfaClient {
  submit(request: IIlrEsfaSubmitRequest): Promise<IIlrEsfaSubmitResult>;
}
