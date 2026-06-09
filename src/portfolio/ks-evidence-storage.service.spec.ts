import { StorageKeyBuilder } from '../storage/storage-key.builder.js';

import { KsEvidenceStorageService } from './ks-evidence-storage.service.js';

describe('KsEvidenceStorageService', () => {
  const service = new KsEvidenceStorageService(new StorageKeyBuilder());

  it('accepts a valid apprentice evidence key', () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const apprenticeId = '22222222-2222-2222-2222-222222222222';
    const key = `orgs/${orgId}/learners/${apprenticeId}/evidence/obj/file.pdf`;
    expect(() =>
      service.assertEvidenceStorageKey(orgId, apprenticeId, key),
    ).not.toThrow();
  });

  it('returns expected evidence key prefix', () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const apprenticeId = '22222222-2222-2222-2222-222222222222';

    expect(service.expectedEvidenceKeyPrefix(orgId, apprenticeId)).toBe(
      `orgs/${orgId}/learners/${apprenticeId}/evidence/`,
    );
  });

  it('rejects keys outside apprentice evidence namespace', () => {
    const orgId = '11111111-1111-1111-1111-111111111111';
    const apprenticeId = '22222222-2222-2222-2222-222222222222';
    const key = `orgs/${orgId}/export/obj/file.pdf`;
    expect(() =>
      service.assertEvidenceStorageKey(orgId, apprenticeId, key),
    ).toThrow();
  });
});
