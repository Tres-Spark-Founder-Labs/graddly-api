import { percentToEifRag, shouldShowEifAlert } from './eif-rag.util.js';
import { EifRag } from './enums/eif-rag.enum.js';

describe('eif-rag.util', () => {
  describe('percentToEifRag', () => {
    it('maps PRD thresholds red / amber / green', () => {
      expect(percentToEifRag(59)).toBe(EifRag.RED);
      expect(percentToEifRag(60)).toBe(EifRag.AMBER);
      expect(percentToEifRag(79)).toBe(EifRag.AMBER);
      expect(percentToEifRag(80)).toBe(EifRag.GREEN);
    });
  });

  describe('shouldShowEifAlert', () => {
    it('is true when any criterion is below 75%', () => {
      expect(shouldShowEifAlert([80, 74, 90])).toBe(true);
      expect(shouldShowEifAlert([80, 75, 90])).toBe(false);
    });
  });
});
