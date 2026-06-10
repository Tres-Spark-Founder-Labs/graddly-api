import { IlrPayloadSerializerService } from './ilr-payload-serializer.service.js';
import { buildSampleFieldMap } from './testing/ilr-test-fixtures.js';

describe('IlrPayloadSerializerService', () => {
  const service = new IlrPayloadSerializerService();

  const baseInput = {
    organisationId: 'org-1',
    ukprn: '10012345',
    collectionPeriod: '2025-10',
    academicYear: '2025-26',
    fields: buildSampleFieldMap(),
    isAmendment: false,
    priorEsfaReference: null as string | null,
    learnerRecordId: 'record-1',
  };

  it('serialises submit payload with amendment metadata', () => {
    const input = {
      ...baseInput,
      isAmendment: true,
      priorEsfaReference: 'ESFA-OLD',
    };

    const body = service.toRequestBody(input);
    expect(body.format).toBe('ilr-xml');
    expect(body.isAmendment).toBe(true);
    expect(body.priorEsfaReference).toBe('ESFA-OLD');
    expect(body.fields).toEqual(buildSampleFieldMap());
    expect(typeof body.xml).toBe('string');

    const request = service.toSubmitRequest(input);
    expect(request.priorEsfaReference).toBe('ESFA-OLD');
    expect(request.xmlPayload).toContain(
      '<PriorEsfaReference>ESFA-OLD</PriorEsfaReference>',
    );
  });

  it('builds well-formed ILR XML with required nodes', () => {
    const xml = service.toIlrXml(baseInput);

    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<Message>');
    expect(xml).toContain('<UKPRN>10012345</UKPRN>');
    expect(xml).toContain('<CollectionPeriod>2025-10</CollectionPeriod>');
    expect(xml).toContain('<AcademicYear>2025-26</AcademicYear>');
    expect(xml).toContain('<IsAmendment>false</IsAmendment>');
    expect(xml).toContain('<LearnerRecordId>record-1</LearnerRecordId>');
    expect(xml).toContain('<Learner>');
    expect(xml).toContain('<FamilyName>Folio</FamilyName>');
    expect(xml).toContain('<LearningDelivery>');
    expect(xml).toContain('<LearnAimRef>ST0001</LearnAimRef>');
    expect(xml).toContain('<Provider>');
    expect(xml).not.toContain('<ULN>');
  });

  it('escapes XML special characters in field values', () => {
    const fields = buildSampleFieldMap();
    fields.Learner.GivenNames = 'Tom & "Jerry" <test>';

    const xml = service.toIlrXml({ ...baseInput, fields });
    expect(xml).toContain(
      '<GivenNames>Tom &amp; &quot;Jerry&quot; &lt;test&gt;</GivenNames>',
    );
  });
});
