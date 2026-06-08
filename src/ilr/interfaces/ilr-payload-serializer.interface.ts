import type { IIlrEsfaSubmitRequest } from './ilr-esfa.client.interface.js';

export interface IIlrPayloadSerializerInput {
  organisationId: string;
  ukprn: string;
  collectionPeriod: string;
  academicYear: string;
  fields: Record<string, Record<string, string | null>>;
  isAmendment: boolean;
  priorEsfaReference?: string | null;
  learnerRecordId: string;
}

export interface IIlrPayloadSerializer {
  toSubmitRequest(input: IIlrPayloadSerializerInput): IIlrEsfaSubmitRequest;
  toRequestBody(input: IIlrPayloadSerializerInput): Record<string, unknown>;
}
