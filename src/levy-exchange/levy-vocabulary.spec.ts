import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { loadEligibilityRulesConfig } from './config/eligibility-rules.config.js';
import { VocabularyController } from './controllers/vocabulary.controller.js';
import { CheckLevyEligibilityDto } from './dto/check-levy-eligibility.dto.js';
import { UpsertRecipientProfileDto } from './dto/upsert-recipient-profile.dto.js';
import { UpsertTransferPreferencesDto } from './dto/upsert-transfer-preferences.dto.js';
import {
  LEVY_EMPLOYEE_COUNT_BANDS,
  LEVY_PROGRAMME_TYPE_SUGGESTIONS,
  LEVY_REGIONS,
  LEVY_SECTOR_SUGGESTIONS,
  normaliseOpenVocabularyValue,
} from './levy-vocabulary.js';

/** Validation errors as `{ property: [messages] }`, for readable assertions. */
async function errorsOf<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<Record<string, string[]>> {
  const errors = await validate(plainToInstance(cls, plain));
  return Object.fromEntries(
    errors.map((error) => [
      error.property,
      Object.values(error.constraints ?? {}),
    ]),
  );
}

const profile = (overrides: Record<string, unknown> = {}) => ({
  sector: 'Construction',
  region: 'North West',
  employeeCountBand: '10-49',
  programmeType: 'ST0415 Software Developer',
  transferAmountRequired: '15000.00',
  hasDasAccount: false,
  ...overrides,
});

const preferences = (overrides: Record<string, unknown> = {}) => ({
  sectors: ['Construction'],
  regions: ['North West'],
  sizeBands: ['10-49'],
  programmeTypes: ['ST0415 Software Developer'],
  maxPerRecipient: null,
  openMatching: false,
  anonymousMatching: false,
  ...overrides,
});

const everyRegion = LEVY_REGIONS.join(', ');
const everyBand = LEVY_EMPLOYEE_COUNT_BANDS.join(', ');

describe('the Levy Exchange vocabulary', () => {
  describe('the closed sets', () => {
    it('holds the twelve UK regions, once each', () => {
      expect(LEVY_REGIONS).toHaveLength(12);
      expect(new Set(LEVY_REGIONS).size).toBe(12);
    });

    it('holds four employee count bands, once each', () => {
      expect([...LEVY_EMPLOYEE_COUNT_BANDS]).toEqual([
        '1-9',
        '10-49',
        '50-249',
        '250+',
      ]);
    });

    it('serves every value as the value stored and compared — already normalised', () => {
      for (const value of [
        ...LEVY_REGIONS,
        ...LEVY_EMPLOYEE_COUNT_BANDS,
        ...LEVY_SECTOR_SUGGESTIONS,
        ...LEVY_PROGRAMME_TYPE_SUGGESTIONS,
      ]) {
        expect(normaliseOpenVocabularyValue(value)).toBe(value);
      }
    });
  });

  describe('open-field normalisation', () => {
    it('trims and collapses internal whitespace', () => {
      expect(
        normaliseOpenVocabularyValue('  Digital \t &   Technology\n'),
      ).toBe('Digital & Technology');
    });

    it('does not change case — the values are display strings, compared exactly', () => {
      expect(normaliseOpenVocabularyValue('retail')).toBe('retail');
      expect(normaliseOpenVocabularyValue('RETAIL')).toBe('RETAIL');
    });

    it('is idempotent', () => {
      const once = normaliseOpenVocabularyValue('  Health   & Social Care ');
      expect(normaliseOpenVocabularyValue(once)).toBe(once);
    });
  });

  describe('GET /levy-exchange/vocabulary', () => {
    it('serves closed fields with permitted values and open fields with suggestions, apart', () => {
      expect(new VocabularyController().get()).toEqual({
        closed: {
          region: [...LEVY_REGIONS],
          employeeCountBand: [...LEVY_EMPLOYEE_COUNT_BANDS],
        },
        open: {
          sector: [...LEVY_SECTOR_SUGGESTIONS],
          programmeType: [...LEVY_PROGRAMME_TYPE_SUGGESTIONS],
        },
      });
    });
  });

  describe('the recipient profile PUT', () => {
    it('accepts vocabulary values', async () => {
      await expect(
        errorsOf(UpsertRecipientProfileDto, profile()),
      ).resolves.toEqual({});
    });

    it('rejects a region outside the twelve, naming the field and every permitted value', async () => {
      await expect(
        errorsOf(UpsertRecipientProfileDto, profile({ region: 'north_west' })),
      ).resolves.toEqual({
        region: [`region must be one of the permitted values: ${everyRegion}`],
      });
    });

    it('rejects a band outside the four — the old slug and a near-miss alike', async () => {
      for (const band of ['10_49', '10–49', ' 10-49']) {
        await expect(
          errorsOf(
            UpsertRecipientProfileDto,
            profile({ employeeCountBand: band }),
          ),
        ).resolves.toEqual({
          employeeCountBand: [
            `employeeCountBand must be one of the permitted values: ${everyBand}`,
          ],
        });
      }
    });

    it('accepts any sector and programme type — suggestions are not constraints', async () => {
      await expect(
        errorsOf(
          UpsertRecipientProfileDto,
          profile({ sector: 'Retail', programmeType: 'ST0999 Butcher' }),
        ),
      ).resolves.toEqual({});
    });
  });

  describe('the donor preference write', () => {
    it('accepts vocabulary values and empty lists', async () => {
      await expect(
        errorsOf(UpsertTransferPreferencesDto, preferences()),
      ).resolves.toEqual({});
      await expect(
        errorsOf(
          UpsertTransferPreferencesDto,
          preferences({ regions: [], sizeBands: [] }),
        ),
      ).resolves.toEqual({});
    });

    it('rejects a list holding one region outside the twelve', async () => {
      await expect(
        errorsOf(
          UpsertTransferPreferencesDto,
          preferences({ regions: ['North West', 'Midlands'] }),
        ),
      ).resolves.toEqual({
        regions: [
          `regions must be one of the permitted values: ${everyRegion}`,
        ],
      });
    });

    it('rejects a size band outside the four', async () => {
      await expect(
        errorsOf(
          UpsertTransferPreferencesDto,
          preferences({ sizeBands: ['10_49'] }),
        ),
      ).resolves.toEqual({
        sizeBands: [
          `sizeBands must be one of the permitted values: ${everyBand}`,
        ],
      });
    });

    it('accepts any sectors and programme types', async () => {
      await expect(
        errorsOf(
          UpsertTransferPreferencesDto,
          preferences({
            sectors: ['Retail'],
            programmeTypes: ['ST0999 Butcher'],
          }),
        ),
      ).resolves.toEqual({});
    });
  });

  describe('the eligibility check', () => {
    const check = (overrides: Record<string, unknown> = {}) => ({
      employeeCountBand: '10-49',
      sector: 'Construction',
      region: 'North West',
      hasDasAccount: false,
      ...overrides,
    });

    it('takes the same closed values, and refuses its old slugs rather than answering wrongly', async () => {
      await expect(errorsOf(CheckLevyEligibilityDto, check())).resolves.toEqual(
        {},
      );
      await expect(
        errorsOf(
          CheckLevyEligibilityDto,
          check({ employeeCountBand: '10_49', region: 'north_west' }),
        ),
      ).resolves.toEqual({
        employeeCountBand: [
          `employeeCountBand must be one of the permitted values: ${everyBand}`,
        ],
        region: [`region must be one of the permitted values: ${everyRegion}`],
      });
    });

    /**
     * The technology/digital split happened because the checker's sector list
     * and the funding-band keys were two lists. The keys and the eligible
     * bands must be vocabulary values, or a band can again be configured for a
     * value nobody sends.
     */
    it('configures eligibility and funding bands only on vocabulary values', () => {
      const rules = loadEligibilityRulesConfig();
      for (const band of rules.eligibleEmployeeBands) {
        expect(LEVY_EMPLOYEE_COUNT_BANDS).toContain(band);
      }
      for (const sector of Object.keys(rules.fundingBands.bySector)) {
        expect(LEVY_SECTOR_SUGGESTIONS).toContain(sector);
      }
    });
  });
});
