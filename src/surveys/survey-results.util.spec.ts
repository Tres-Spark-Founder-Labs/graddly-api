import { SurveyQuestionType } from './enums/survey-question-type.enum.js';
import {
  buildQuestionResults,
  computeNps,
  computeTopTerms,
} from './survey-results.util.js';

describe('survey-results', () => {
  describe('computeNps', () => {
    /**
     * The failure this guards against: averaging the 0–10 answers produces a
     * plausible number on the same scale that is not NPS, and no one reading a
     * dashboard would catch it. Here the mean is 8.0 and the NPS is 20.
     */
    it('is promoters minus detractors, not the mean', () => {
      const scores = [10, 9, 8, 7, 6];

      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      expect(mean).toBe(8);
      // 2 promoters (10, 9), 1 detractor (6), 5 responses → (2-1)/5 = 20%.
      expect(computeNps(scores)).toBe(20);
    });

    it('counts passives in the denominator', () => {
      // Dropping passives is the classic way to inflate the score: it would
      // give 100 here rather than 33.
      expect(computeNps([10, 8, 8])).toBe(33);
    });

    it('can be negative', () => {
      expect(computeNps([0, 1, 2, 10])).toBe(-50);
    });

    /** Zero is a real and quite bad NPS; "nobody answered" is not that. */
    it('is null with no responses rather than zero', () => {
      expect(computeNps([])).toBeNull();
    });

    it('treats 9 and 10 as promoters and 6 as a detractor', () => {
      expect(computeNps([9])).toBe(100);
      expect(computeNps([6])).toBe(-100);
      expect(computeNps([7])).toBe(0);
    });
  });

  describe('computeTopTerms', () => {
    it('counts a term once per response, not once per mention', () => {
      const terms = computeTopTerms([
        'communication communication communication',
        'communication was good',
      ]);

      // One effusive response must not manufacture a theme on its own.
      expect(terms.find((t) => t.term === 'communication')?.count).toBe(2);
    });

    it('drops stop words and short words', () => {
      const terms = computeTopTerms([
        'the tutor was very good',
        'the tutor was very good',
      ]);

      expect(terms.map((t) => t.term)).toContain('tutor');
      expect(terms.map((t) => t.term)).not.toContain('the');
      expect(terms.map((t) => t.term)).not.toContain('was');
    });

    it('ignores terms mentioned by only one respondent', () => {
      const terms = computeTopTerms(['idiosyncratic remark', 'something else']);

      expect(terms).toEqual([]);
    });

    it('returns nothing for no responses', () => {
      expect(computeTopTerms([])).toEqual([]);
    });
  });

  describe('buildQuestionResults', () => {
    const questions = [
      { id: 'q1', type: SurveyQuestionType.LIKERT, prompt: 'Communication?' },
      { id: 'q2', type: SurveyQuestionType.NPS, prompt: 'Recommend us?' },
      { id: 'q3', type: SurveyQuestionType.TEXT, prompt: 'Anything else?' },
    ];

    it('averages scales and collects free text', () => {
      const results = buildQuestionResults(questions, [
        { q1: 4, q2: 9, q3: 'Very responsive' },
        { q1: 5, q2: 10, q3: 'No complaints' },
      ]);

      expect(results[0].averageScore).toBe(4.5);
      expect(results[1].averageScore).toBe(9.5);
      expect(results[2].textResponses).toEqual([
        'Very responsive',
        'No complaints',
      ]);
    });

    /** Zero would render as a rating of zero on a dashboard. */
    it('gives free text a null score, never zero', () => {
      const results = buildQuestionResults(questions, [{ q3: 'Fine' }]);

      expect(results[2].averageScore).toBeNull();
      expect(results[2].responseCount).toBe(1);
    });

    it('reports a null average for a question nobody answered', () => {
      const results = buildQuestionResults(questions, [{ q3: 'Only text' }]);

      expect(results[0].averageScore).toBeNull();
      expect(results[0].responseCount).toBe(0);
    });

    it('ignores blank answers rather than counting them as responses', () => {
      const results = buildQuestionResults(questions, [
        { q1: 4, q3: '' },
        { q3: 'Something' },
      ]);

      expect(results[0].responseCount).toBe(1);
      expect(results[2].responseCount).toBe(1);
    });
  });
});
