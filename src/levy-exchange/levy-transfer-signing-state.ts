import { OrganisationRole } from '../organisations/organisation-role.enum.js';

import { LevyTransferParty } from './enums/levy-transfer-party.enum.js';
import { LevyTransferStatus } from './enums/levy-transfer-status.enum.js';

import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface.js';

/** The fields of a signature slot the signing decision depends on. */
export interface ILevyTransferSigningSlot {
  party: LevyTransferParty;
  signOrder: number;
  userId: string;
  signedAt: Date | null;
}

interface ITransferParties {
  donorOrganisationId: string;
  recipientOrganisationId: string;
}

/**
 * Whether this user may sign the slot: its assigned signer, or an owner or
 * admin of the active organisation.
 *
 * `BilateralCoSignOrchestrator` refuses anyone else. It calls this same
 * function, so the DTO's `actionRequired` and the sign endpoint cannot
 * disagree about who may sign — the failure the employer commitment board had
 * when the board's "pending" and the API's turn order were two computations.
 */
export function mayUserSignSlot(
  user: AuthenticatedUser,
  signerUserId: string,
): boolean {
  if (signerUserId === user.id) {
    return true;
  }
  const roles = user.roles ?? [];
  return (
    roles.includes(OrganisationRole.OWNER) ||
    roles.includes(OrganisationRole.ADMIN)
  );
}

/** Which side of the transfer an organisation is on, if either. */
export function partyForOrganisation(
  transfer: ITransferParties,
  organisationId: string,
): LevyTransferParty | null {
  if (organisationId === transfer.donorOrganisationId) {
    return LevyTransferParty.DONOR;
  }
  if (organisationId === transfer.recipientOrganisationId) {
    return LevyTransferParty.RECIPIENT;
  }
  return null;
}

/**
 * The party whose signature is awaited: the lowest-order unsigned slot, while
 * the transfer is open for signing. Null otherwise — before the agreement PDF
 * exists (`draft`), and once both parties have signed.
 */
export function nextSigningParty(
  status: LevyTransferStatus,
  slots: ILevyTransferSigningSlot[],
): LevyTransferParty | null {
  if (status !== LevyTransferStatus.PENDING_SIGNATURES) {
    return null;
  }
  const pending = slots
    .filter((slot) => slot.signedAt === null)
    .sort((a, b) => a.signOrder - b.signOrder);
  return pending[0]?.party ?? null;
}

/**
 * Whether this user can sign this transfer right now — the transfer DTO's
 * `actionRequired`.
 *
 * Follows `employerCanSignNow` in commitment-board.service.ts: not "my party
 * is unsigned" but "my party is unsigned AND every lower signOrder has
 * signed", i.e. my party is next. It also applies the orchestrator's signer
 * rule, so `true` is never an invitation the API would then refuse.
 */
export function transferActionRequired(
  user: AuthenticatedUser,
  transfer: ITransferParties & { status: LevyTransferStatus },
  slots: ILevyTransferSigningSlot[],
): boolean {
  const organisationId = user.organisationId;
  if (!organisationId) {
    return false;
  }
  const party = partyForOrganisation(transfer, organisationId);
  if (party === null) {
    return false;
  }
  if (nextSigningParty(transfer.status, slots) !== party) {
    return false;
  }
  const slot = slots.find((candidate) => candidate.party === party);
  return slot !== undefined && mayUserSignSlot(user, slot.userId);
}
