export interface IEvidencePackJobPayload {
  jobId: string;
  organisationId: string;
  userId: string;
  additionalStorageKeys?: string[];
}
