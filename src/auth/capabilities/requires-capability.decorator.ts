import { SetMetadata } from '@nestjs/common';

import { Capability } from './capability.enum.js';

/** Metadata key for {@link RequiresCapability}. */
export const CAPABILITY_KEY = 'requiredCapability';

/**
 * Restricts a route to users whose active-organisation role satisfies the
 * named capability.
 *
 * Prefer this over `@Roles(...)` for anything a provider might reasonably
 * want to restrict. `@Roles(OWNER, ADMIN)` states an answer; this states the
 * question — *"who may submit an ILR?"* — and looks the answer up in
 * `capability-roles.ts`, which is the file the client's decision changes.
 */
export const RequiresCapability = (capability: Capability) =>
  SetMetadata(CAPABILITY_KEY, capability);
