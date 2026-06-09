import type { LevyTransferParty } from '../enums/levy-transfer-party.enum.js';

export type BilateralSigningSlotStatus = 'pending' | 'signed';

export interface IBilateralSigningSlot {
  party: LevyTransferParty;
  signOrder: number;
  signerUserId: string;
  status: BilateralSigningSlotStatus;
  signatureRecordId: string | null;
  /** Cross-org chain PDF key in the signer's organisation scope. */
  sourcePdfKey?: string | null;
}

export interface IBilateralSignResult {
  party: LevyTransferParty;
  signedPdfKey: string;
  downloadUrl?: string;
  downloadExpiresAt?: string;
  signatureRecordId: string;
  nextParty: LevyTransferParty | null;
}
