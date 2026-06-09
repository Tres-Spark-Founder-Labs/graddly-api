import { EifRag } from './enums/eif-rag.enum.js';

export function percentToEifRag(percent: number): EifRag {
  if (percent < 60) return EifRag.RED;
  if (percent < 80) return EifRag.AMBER;
  return EifRag.GREEN;
}

export function shouldShowEifAlert(criteriaPercents: number[]): boolean {
  return criteriaPercents.some((p) => p < 75);
}
