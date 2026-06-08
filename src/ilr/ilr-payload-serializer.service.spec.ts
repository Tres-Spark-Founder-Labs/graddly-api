import { IlrPayloadSerializerService } from './ilr-payload-serializer.service.js';
import { buildSampleFieldMap } from './testing/ilr-test-fixtures.js';

describe('IlrPayloadSerializerService', () => {
  const service = new IlrPayloadSerializerService();

  it('serialises submit payload with amendment metadata', () => {
    const input = {
      organisationId: 'org-1',
      ukprn: '10012345',
      collectionPeriod: '2025-10',
      academicYear: '2025-26',
      fields: buildSampleFieldMap(),
      isAmendment: true,
      priorEsfaReference: 'ESFA-OLD',
      learnerRecordId: 'record-1',
    };

    const body = service.toRequestBody(input);
    expect(body.isAmendment).toBe(true);
    expect(body.priorEsfaReference).toBe('ESFA-OLD');
    expect(body.fields).toEqual(buildSampleFieldMap());

    const request = service.toSubmitRequest(input);
    expect(request.priorEsfaReference).toBe('ESFA-OLD');
  });
});
