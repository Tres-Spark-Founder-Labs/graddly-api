/**
 * F2.3.1 AC7 — what may be written into `das_api_activity.requestSummary`.
 *
 * The activity log exists so a provider can see what we sent the ESFA and what
 * came back. It must not become the easiest place on the platform to find a
 * bearer token: an audit table that leaks credentials is worse than no audit
 * table, because it is long-lived, widely readable, and exported.
 *
 * The rule is deny-by-key rather than allow-by-key. An allow-list would look
 * safer and would silently drop useful fields every time the ESFA adds one;
 * a deny-list keeps the log useful and fails toward redaction for the names
 * that actually carry secrets.
 */

const REDACTED = '[redacted]';

/**
 * Matched against the lowercased key, as a substring. `access_token`,
 * `refreshToken` and `Authorization` all have to be caught without anyone
 * remembering to add each spelling.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'authorization',
  'token',
  'secret',
  'password',
  'credential',
  'apikey',
  'api_key',
  'clientsecret',
  'client_secret',
  'assertion',
  'signature',
];

/** Long enough for an ESFA error body to stay diagnosable, short enough that
 *  one pathological response cannot bloat the table. */
export const DAS_ACTIVITY_ERROR_MAX_LENGTH = 4_000;

/** Guards against a deeply nested payload turning into unbounded work. */
const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Recursively redact sensitive values, preserving shape so the log still shows
 * which fields were sent.
 */
export function scrubDasActivityValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubDasActivityValue(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = isSensitiveKey(key)
        ? REDACTED
        : scrubDasActivityValue(item, depth + 1);
    }
    return out;
  }

  return value;
}

export function scrubDasActivitySummary(
  value: unknown,
): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }
  const scrubbed = scrubDasActivityValue(value);
  if (scrubbed === null || typeof scrubbed !== 'object') {
    return { value: scrubbed };
  }
  return Array.isArray(scrubbed)
    ? { items: scrubbed }
    : (scrubbed as Record<string, unknown>);
}

/**
 * Strip credentials that some ESFA endpoints accept as query parameters.
 *
 * The URL is recorded because it identifies the call, but a token in a query
 * string is exactly as sensitive as one in a header — and rather more likely
 * to be copied into a support ticket.
 */
export function scrubDasActivityUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Not a parseable URL; return it unchanged rather than lose the record of
    // which call was attempted.
    return rawUrl;
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (isSensitiveKey(key)) {
      parsed.searchParams.set(key, REDACTED);
    }
  }
  return parsed.toString();
}

export function truncateDasActivityError(
  message: string | null,
): string | null {
  if (!message) {
    return null;
  }
  return message.length > DAS_ACTIVITY_ERROR_MAX_LENGTH
    ? `${message.slice(0, DAS_ACTIVITY_ERROR_MAX_LENGTH)}…[truncated]`
    : message;
}
