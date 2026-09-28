/**
 * Machine-readable codes on authentication failures, so a client can tell
 * two rejections apart that carry the same status.
 *
 * ── WHY A CODE AND NOT THE MESSAGE ──────────────────────────────────────────
 *
 * `POST /auth/refresh` returns 401 both when a refresh token has simply
 * expired and when a session was killed for inactivity. The first deserves
 * "your session ended, sign in again"; the second deserves "you were signed
 * out after 8 hours of inactivity", which is a different sentence and a
 * different support call. Matching on the message string would make the
 * frontend's behaviour depend on our wording, so the code travels as its own
 * field on the error body and the wording stays free to change.
 *
 * `AllExceptionsFilter` spreads an HttpException's object response into the
 * response body, so throwing with `{ code }` is enough to surface it —
 * alongside `statusCode`, `error`, `message`, `timestamp`, `path` and
 * `requestId`.
 */
export enum AuthErrorCode {
  /**
   * PRD §7.2 idle timeout. The refresh token was valid and the family has
   * been revoked: re-authentication is required, and this was not an ordinary
   * expiry.
   */
  SESSION_IDLE_TIMEOUT = 'SESSION_IDLE_TIMEOUT',

  /**
   * PRD §7.2 MFA requirement. The caller is authenticated and holds owner or
   * admin in a provider or employer organisation without MFA. Only the
   * enrolment endpoints will serve them until they have enrolled.
   */
  MFA_ENROLMENT_REQUIRED = 'MFA_ENROLMENT_REQUIRED',
}
