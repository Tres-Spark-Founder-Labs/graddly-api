/**
 * Pre-commit checks for the API repo.
 *
 * Mirrors `gradlly-frontend/lint-staged.config.js`. This repo had no hook at
 * all, which is how a commit landed with two lint errors in a spec: eslint was
 * run afterwards rather than before, and nothing stopped it.
 *
 * The glob includes `.mjs`/`.cjs` for the same reason the frontend's does —
 * scripts in those extensions would otherwise skip the hook while appearing to
 * be covered by it.
 */
export default {
  '*.{ts,js,mjs,cjs}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
