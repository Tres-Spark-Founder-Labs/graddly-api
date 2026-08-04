import {
  SurveyQuestionType,
  type ISurveyQuestion,
} from './enums/survey-question-type.enum.js';

import type { SurveyAnswers } from './entities/survey-invitation.entity.js';

/**
 * F2.4.3 AC3 — "average scores per question, NPS score, free-text themes".
 */

export interface ISurveyQuestionResult {
  questionId: string;
  prompt: string;
  type: SurveyQuestionType;
  responseCount: number;
  averageScore: number | null;
  textResponses: string[];
}

export interface ISurveyTermFrequency {
  term: string;
  count: number;
}

/**
 * Net Promoter Score.
 *
 * Promoters (9–10) minus detractors (0–6), as a percentage of respondents.
 * Passives (7–8) count toward the denominator and nothing else — dropping them
 * is the classic way to inflate the number.
 *
 * Deliberately NOT an average of the 0–10 answers. That would produce a
 * plausible-looking figure on the same scale that is not NPS, and nobody
 * reading a dashboard would catch it.
 *
 * Returns null with no responses rather than 0: zero is a real and quite bad
 * NPS, and "nobody has answered yet" must not be reported as it.
 */
export function computeNps(scores: number[]): number | null {
  if (scores.length === 0) {
    return null;
  }
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

/**
 * Words too common to be a theme. Deliberately short — an aggressive list
 * starts removing domain words like "training" that are the whole point.
 */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'but',
  'not',
  'you',
  'all',
  'any',
  'can',
  'had',
  'her',
  'was',
  'one',
  'our',
  'out',
  'has',
  'him',
  'his',
  'how',
  'its',
  'new',
  'now',
  'old',
  'see',
  'two',
  'way',
  'who',
  'boy',
  'did',
  'get',
  'let',
  'put',
  'say',
  'she',
  'too',
  'use',
  'that',
  'this',
  'with',
  'have',
  'from',
  'they',
  'been',
  'were',
  'said',
  'very',
  'what',
  'when',
  'your',
  'them',
  'than',
  'then',
  'more',
  'some',
  'into',
  'only',
  'also',
  'just',
  'over',
  'such',
  'would',
  'could',
  'should',
  'their',
  'there',
  'about',
  'which',
  'these',
  'other',
  'because',
  'really',
  'quite',
]);

/**
 * F2.4.3 AC3 — "free-text themes".
 *
 * WHAT THIS IS: term frequency. Words of four or more characters, minus a
 * small stop-word list, counted across all free-text answers.
 *
 * WHAT THIS IS NOT: theme extraction. Real theming clusters *meaning* —
 * it knows "slow to respond" and "never returns my calls" are the same
 * complaint, and this cannot. It will also happily report "apprentice" as the
 * top theme of an apprenticeship survey.
 *
 * It is labelled `topTerms` rather than `themes` in the response for exactly
 * that reason. Calling a word count a theme would be the kind of quiet
 * overclaim this project has spent its life removing, and a provider
 * presenting "themes" to an inspector deserves to know what produced them.
 * The raw responses travel alongside so a human can do the real reading.
 */
export function computeTopTerms(
  texts: string[],
  limit = 10,
): ISurveyTermFrequency[] {
  const counts = new Map<string, number>();

  for (const text of texts) {
    const seen = new Set<string>();
    for (const rawWord of text.toLowerCase().split(/[^a-z']+/)) {
      const word = rawWord.replace(/^'+|'+$/g, '');
      if (word.length < 4 || STOP_WORDS.has(word)) {
        continue;
      }
      // Counted once per response, so one effusive paragraph cannot
      // manufacture a theme on its own.
      if (seen.has(word)) {
        continue;
      }
      seen.add(word);
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}

export function buildQuestionResults(
  questions: ISurveyQuestion[],
  responses: SurveyAnswers[],
): ISurveyQuestionResult[] {
  return questions.map((question) => {
    const given = responses
      .map((answers) => answers[question.id])
      .filter((value) => value !== undefined && value !== null && value !== '');

    if (question.type === SurveyQuestionType.TEXT) {
      return {
        questionId: question.id,
        prompt: question.prompt,
        type: question.type,
        responseCount: given.length,
        // Free text has no score. Null rather than 0, which would render as a
        // rating of zero on a dashboard.
        averageScore: null,
        textResponses: given.map((value) => String(value)),
      };
    }

    const scores = given
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));

    return {
      questionId: question.id,
      prompt: question.prompt,
      type: question.type,
      responseCount: scores.length,
      /**
       * NPS questions are averaged here too, and that average is *not* the NPS
       * score — it is the mean of the 0–10 answers, reported per question like
       * any other scale. The NPS figure is computed separately by `computeNps`
       * and carried at the campaign level.
       */
      averageScore:
        scores.length === 0
          ? null
          : Math.round(
              (scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10,
            ) / 10,
      textResponses: [],
    };
  });
}
