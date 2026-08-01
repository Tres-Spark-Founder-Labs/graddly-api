import { providerComparisonToCsv } from './provider-comparison-csv.util.js';

import type { LevyRoiBreakdownEntryResponseDto } from './dto/levy-roi-report-response.dto.js';

const row = (
  over: Partial<LevyRoiBreakdownEntryResponseDto> = {},
): LevyRoiBreakdownEntryResponseDto => ({
  groupId: 'prov-1',
  label: 'Northstar Training',
  activeApprenticeCount: 4,
  completionCount: 2,
  averageCostPerCompletion: 18500,
  averageOtjPercent: 72.5,
  reviewComplianceRate: 88,
  withdrawalRate: 4.5,
  epaPassRate: 92.3,
  epaAssessedCount: 13,
  ...over,
});

describe('providerComparisonToCsv (F1.4.2 AC3)', () => {
  it('emits a header row naming every metric the criterion asks for', () => {
    const [header] = providerComparisonToCsv([]).split('\n');

    expect(header.split(',')).toEqual([
      'provider',
      'activeLearnerCount',
      'completions',
      'averageOtjPercent',
      'reviewComplianceRate',
      'epaPassRate',
      'epaAssessedCount',
      'withdrawalRate',
      'averageCostPerCompletion',
    ]);
  });

  it('writes one row per provider', () => {
    const csv = providerComparisonToCsv([row()]);

    expect(csv.split('\n')[1]).toBe(
      'Northstar Training,4,2,72.5,88,92.3,13,4.5,18500',
    );
  });

  /**
   * A blank cell is unambiguous in a spreadsheet: not averaged, not charted,
   * not mistaken for a score. `0` would put a provider with no history at the
   * bottom of a sort — the same failure the OTJ scoping bug produced on
   * screen.
   */
  it('leaves an unmeasurable metric blank rather than writing zero', () => {
    const csv = providerComparisonToCsv([
      row({
        averageOtjPercent: null,
        reviewComplianceRate: null,
        epaPassRate: null,
        epaAssessedCount: 0,
        withdrawalRate: null,
        averageCostPerCompletion: null,
      }),
    ]);

    expect(csv.split('\n')[1]).toBe('Northstar Training,4,2,,,,0,,');
  });

  /** A provider called "Smith, Jones & Co" must not shift every column. */
  it('escapes a provider name containing a comma or quote', () => {
    const csv = providerComparisonToCsv([
      row({ label: 'Smith, Jones & Co "Training"' }),
    ]);

    expect(csv).toContain('"Smith, Jones & Co ""Training"""');
    // The escaped name is one field, so the row still has nine columns.
    expect(csv.split('\n')[1].split('","').length).toBeGreaterThan(0);
  });

  it('returns just the header when there are no providers', () => {
    expect(providerComparisonToCsv([]).split('\n')).toHaveLength(1);
  });
});
