import { IlrEsfaNoopClient } from './ilr-esfa-noop.client.js';
import { buildSampleFieldMap } from './testing/ilr-test-fixtures.js';

describe('IlrEsfaNoopClient', () => {
  const client = new IlrEsfaNoopClient();

  it('returns deterministic reference and stable receipt shape', async () => {
    const base = {
      organisationId: 'org-1',
      ukprn: '10012345',
      collectionPeriod: '2025-10',
      academicYear: '2025-26',
      fields: buildSampleFieldMap(),
      learnerRecordId: '22222222-2222-2222-2222-222222222222',
    };

    const first = await client.submit({ ...base, isAmendment: false });
    const second = await client.submit({ ...base, isAmendment: false });
    const amend = await client.submit({
      ...base,
      isAmendment: true,
      priorEsfaReference: first.esfaReference,
    });

    expect(first.esfaReference).toMatch(/^NOOP-/);
    expect(first.esfaReference).toBe(second.esfaReference);
    expect(amend.esfaReference).not.toBe(first.esfaReference);
    expect(first.receipt.provider).toBe('noop');
    expect(first.receipt.status).toBe('accepted');
  });
});
