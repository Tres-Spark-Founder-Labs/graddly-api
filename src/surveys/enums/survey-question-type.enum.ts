/**
 * F2.4.3 AC1 — "Likert scale and free text".
 *
 * NPS is separated from Likert rather than treated as an eleven-point Likert,
 * because AC3 asks for an NPS score and NPS is not an average. It is the
 * percentage of promoters minus the percentage of detractors on a specific
 * 0–10 question, and averaging that scale instead would produce a number that
 * looks like NPS, is not NPS, and no one would catch.
 */
export enum SurveyQuestionType {
  /** 1–5 agreement scale. Averaged for the per-question score. */
  LIKERT = 'likert',
  /** 0–10 recommendation scale. Feeds the NPS calculation, never averaged. */
  NPS = 'nps',
  /** Free text. Never scored. */
  TEXT = 'text',
}

/** AC1 — "up to 10 questions". */
export const SURVEY_MAX_QUESTIONS = 10;

/** Inclusive bounds per question type, used for validating a response. */
export const SURVEY_SCALE_BOUNDS: Record<
  SurveyQuestionType.LIKERT | SurveyQuestionType.NPS,
  { min: number; max: number }
> = {
  [SurveyQuestionType.LIKERT]: { min: 1, max: 5 },
  [SurveyQuestionType.NPS]: { min: 0, max: 10 },
};

/** Re-exported here so results code imports one module for the shape and the type. */
export interface ISurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  prompt: string;
}
