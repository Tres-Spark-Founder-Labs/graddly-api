/* eslint-disable @typescript-eslint/naming-convention -- ESFA ILR entity and field names (Learner, LearnRefNumber, UKPRN) are PascalCase by specification. */
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Organisation } from '../organisations/entities/organisation.entity.js';

import { IlrLearnerRecord } from './entities/ilr-learner-record.entity.js';
import { IlrLearnerRecordStatus } from './enums/ilr-learner-record-status.enum.js';
import {
  IlrPayloadSerializerService,
  ilrReturnFilename,
  returnYearCode,
  toIlrReturnXml,
} from './ilr-payload-serializer.service.js';
import {
  ILR_RETURN_FILE_COVERAGE,
  IlrReturnFileService,
} from './ilr-return-file.service.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/**
 * 5.4 — the whole ILR return as one XML file: every learner record in the
 * collection period, or a refusal that says why. Never a short file.
 */
describe('IlrReturnFileService', () => {
  let service: IlrReturnFileService;
  const recordFind = jest.fn();
  const organisationFindOne = jest.fn();
  const user = { id: 'user-1', organisationId: 'org-1' } as AuthenticatedUser;

  const record = (
    n: number,
    status = IlrLearnerRecordStatus.VALIDATED,
    academicYear = '2025-26',
  ) => ({
    id: `rec-${n}`,
    academicYear,
    collectionPeriod: '2025-10',
    mappingConfigVersion: 1,
    status,
    fields: {
      Learner: {
        LearnRefNumber: `LRN${n}`,
        FamilyName: n === 1 ? "O'Brien & Sons" : `Learner${n}`,
        GivenNames: 'Sam',
        ULN: `100000000${n}`,
      },
      LearningDelivery: {
        LearnAimRef: 'ZPROG001',
        LearnStartDate: '2025-01-15',
        LearnPlanEndDate: '2026-12-31',
        ProgType: '25',
      },
      Provider: { UKPRN: '10000001' },
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    organisationFindOne.mockResolvedValue({ id: 'org-1', ukprn: '10000001' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        IlrReturnFileService,
        IlrPayloadSerializerService,
        {
          provide: getRepositoryToken(IlrLearnerRecord),
          useValue: { find: recordFind },
        },
        {
          provide: getRepositoryToken(Organisation),
          useValue: { findOne: organisationFindOne },
        },
      ],
    }).compile();
    service = moduleRef.get(IlrReturnFileService);
  });

  it('returns every learner record in the period as one file, named the ESFA way', async () => {
    recordFind.mockResolvedValue([record(1), record(2), record(3)]);

    const file = await service.build(user, { collectionPeriod: '2025-10' });

    expect(file.learnerCount).toBe(3);
    expect(file.ukprn).toBe('10000001');
    expect(file.academicYear).toBe('2025-26');
    expect(file.coverage).toBe(ILR_RETURN_FILE_COVERAGE);
    expect(file.filename).toMatch(/^ILR-10000001-2526-\d{8}-\d{6}-01\.XML$/);
    expect(file.xml.match(/<Learner>/g)).toHaveLength(3);
    expect(recordFind).toHaveBeenCalledWith({
      where: {
        organisationId: 'org-1',
        collectionPeriod: '2025-10',
        isDeleted: false,
      },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  });

  it('refuses, with the count, when any record has not passed validation', async () => {
    recordFind.mockResolvedValue([
      record(1),
      record(2, IlrLearnerRecordStatus.VALIDATION_FAILED),
      record(3, IlrLearnerRecordStatus.DRAFT),
    ]);

    const error = await service
      .build(user, { collectionPeriod: '2025-10' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as Error).message).toContain(
      '2 of 3 learner records for 2025-10 have not passed validation (1 failed, 1 not yet validated)',
    );
    expect((error as Error).message).toContain('none was produced');
  });

  it('refuses a period with no records rather than producing an empty file', async () => {
    recordFind.mockResolvedValue([]);

    await expect(
      service.build(user, { collectionPeriod: '2025-10' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses when the organisation has no UKPRN', async () => {
    organisationFindOne.mockResolvedValue({ id: 'org-1', ukprn: null });

    await expect(
      service.build(user, { collectionPeriod: '2025-10' }),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(recordFind).not.toHaveBeenCalled();
  });

  it('refuses records that span two academic years', async () => {
    recordFind.mockResolvedValue([record(1), record(2, undefined, '2026-27')]);

    await expect(
      service.build(user, { collectionPeriod: '2025-10' }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('toIlrReturnXml', () => {
  const xml = toIlrReturnXml({
    ukprn: '10000001',
    academicYear: '2025-26',
    collectionPeriod: '2025-10',
    generatedAt: new Date('2025-10-05T09:15:30.000Z'),
    mappingConfigVersions: [1],
    coverage: 'Covers the v1 subset -- not the full schema.',
    learners: [
      {
        learnerRecordId: 'rec-1',
        fields: {
          Learner: { LearnRefNumber: 'LRN1', FamilyName: "O'Brien & Sons" },
          LearningDelivery: { LearnAimRef: 'ZPROG001', ProgType: null },
          Provider: { UKPRN: '10000001' },
        },
      },
      {
        learnerRecordId: 'rec-2',
        fields: {
          Learner: { LearnRefNumber: 'LRN2' },
          LearningDelivery: { LearnAimRef: 'ZPROG001' },
          Provider: { UKPRN: '10000001' },
        },
      },
    ],
  });

  it('writes one message with the ESFA header, the provider once, and one Learner per record', () => {
    expect(xml).toContain('<Message xmlns="ESFA/ILR/2025-26">');
    expect(xml).toContain('<Year>2526</Year>');
    // 09:15:30 UTC is 10:15:30 BST on 5 October.
    expect(xml).toContain(
      '<FilePreparationDate>2025-10-05</FilePreparationDate>',
    );
    expect(xml).toContain('<DateTime>2025-10-05T10:15:30</DateTime>');
    expect(xml.match(/<LearningProvider>/g)).toHaveLength(1);
    expect(xml.match(/<Learner>/g)).toHaveLength(2);
    expect(xml).not.toContain('<Provider>');
  });

  it('nests the learning delivery inside its learner, with the submit path escaping and empty-field omission', () => {
    const first = xml.slice(
      xml.indexOf('<Learner>'),
      xml.indexOf('</Learner>'),
    );
    expect(first).toContain('<FamilyName>O&apos;Brien &amp; Sons</FamilyName>');
    expect(first).toContain('<LearningDelivery>');
    expect(first).toContain('<LearnAimRef>ZPROG001</LearnAimRef>');
    expect(first).not.toContain('<ProgType>');
  });

  it('states its coverage in a well-formed comment', () => {
    expect(xml).toContain(
      '<!-- Covers the v1 subset - not the full schema. -->',
    );
    expect(xml).toContain('2 learner record(s)');
  });

  it('names files and years as ESFA does', () => {
    expect(returnYearCode('2025-26')).toBe('2526');
    expect(
      ilrReturnFilename(
        '10000001',
        '2025-26',
        new Date('2026-01-05T23:30:00.000Z'),
      ),
    ).toBe('ILR-10000001-2526-20260105-233000-01.XML');
  });
});
