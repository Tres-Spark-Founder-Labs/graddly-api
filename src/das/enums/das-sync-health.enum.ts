/**
 * F2.3.1 AC5 — the three-band sync health indicator.
 *
 * Deliberately the same vocabulary as the EPA countdown band and the OTJ pace
 * alert, because a provider reading a dashboard should not have to learn what
 * green means twice.
 */
export enum DasSyncHealth {
  GREEN = 'green',
  AMBER = 'amber',
  RED = 'red',
}
