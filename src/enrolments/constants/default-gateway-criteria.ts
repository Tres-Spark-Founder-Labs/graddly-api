import type { GatewayCriterionDefinition } from '../types/gateway-criteria.types.js';

export const DEFAULT_GATEWAY_CRITERIA: GatewayCriterionDefinition[] = [
  {
    code: 'otj_on_track',
    title: 'OTJ hours on track',
    description:
      'Approved off-the-job hours are within 15% of the pace required to meet the 20% target by EPA.',
  },
  {
    code: 'commitment_signed',
    title: 'Commitment statement signed',
    description: 'Tripartite commitment statement is fully signed.',
  },
  {
    code: 'reviews_current',
    title: '12-weekly reviews up to date',
    description: 'No overdue progress reviews remain incomplete.',
  },
  {
    code: 'epa_date_confirmed',
    title: 'EPA date confirmed',
    description: 'End-point assessment date has been set by the provider.',
  },
];
