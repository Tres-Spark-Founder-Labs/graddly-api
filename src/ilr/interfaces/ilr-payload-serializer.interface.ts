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

/** One provider's return: every learner record in a collection period. */
export interface IIlrReturnXmlInput {
  ukprn: string;
  academicYear: string;
  collectionPeriod: string;
  generatedAt: Date;
  mappingConfigVersions: number[];
  /** Written into the file as a comment, so the file says what it covers. */
  coverage: string;
  learners: Array<{
    learnerRecordId: string;
    fields: Record<string, Record<string, string | null>>;
  }>;
}

export interface IIlrPayloadSerializer {
  toSubmitRequest(input: IIlrPayloadSerializerInput): IIlrEsfaSubmitRequest;
  toRequestBody(input: IIlrPayloadSerializerInput): Record<string, unknown>;
  toIlrXml(input: IIlrPayloadSerializerInput): string;
  toIlrReturnXml(input: IIlrReturnXmlInput): string;
}
