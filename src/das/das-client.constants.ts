/**
 * Injection token for `IDasClient`.
 *
 * Consumers inject this rather than `DasHttpClient` so that a deployment
 * without ESFA credentials resolves to `DasManualClient` instead. Mirrors
 * `COMPANIES_HOUSE_CLIENT` in `flowportal-registration.constants.ts`.
 */
export const DAS_CLIENT = Symbol('DAS_CLIENT');
