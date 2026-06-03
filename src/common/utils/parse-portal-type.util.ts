import { PortalType } from '../../organisations/portal-type.enum.js';

/**
 * Safely coerce a raw `X-Portal-Type` header value to a known PortalType, or
 * undefined when missing/unrecognised. Handles comma-joined duplicates
 * (e.g. "provider, provider") by taking the first token.
 */
export function parsePortalType(
  raw: string | undefined,
): PortalType | undefined {
  if (!raw) return undefined;
  const lower = raw.split(',')[0].trim().toLowerCase();
  return (Object.values(PortalType) as string[]).includes(lower)
    ? (lower as PortalType)
    : undefined;
}
