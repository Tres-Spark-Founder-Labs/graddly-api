import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module.js';
import { DasModule } from '../das/das.module.js';
import { EmailModule } from '../email/email.module.js';
import { EsignatureModule } from '../esignature/esignature.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrganisationMembership } from '../organisations/entities/organisation-membership.entity.js';
import { Organisation } from '../organisations/entities/organisation.entity.js';
import { PdfGenerationJob } from '../pdf/entities/pdf-generation-job.entity.js';
import { PdfModule } from '../pdf/pdf.module.js';
import { StorageModule } from '../storage/storage.module.js';

import { DonorLinksController } from './controllers/donor-links.controller.js';
import { DonorOAuthController } from './controllers/donor-oauth.controller.js';
import { EligibilityController } from './controllers/eligibility.controller.js';
import { MatchApplicationsController } from './controllers/match-applications.controller.js';
import { MatchingController } from './controllers/matching.controller.js';
import { RecipientProfileController } from './controllers/recipient-profile.controller.js';
import { SurplusController } from './controllers/surplus.controller.js';
import { TransferPreferencesController } from './controllers/transfer-preferences.controller.js';
import { TransfersController } from './controllers/transfers.controller.js';
import { DasDonorLink } from './entities/das-donor-link.entity.js';
import { DasDonorOAuthToken } from './entities/das-donor-oauth-token.entity.js';
import { DasLevyTranche } from './entities/das-levy-tranche.entity.js';
import { LevyExpiryAlertDispatch } from './entities/levy-expiry-alert-dispatch.entity.js';
import { LevyMatchApplication } from './entities/levy-match-application.entity.js';
import { LevyRecipientProfile } from './entities/levy-recipient-profile.entity.js';
import { LevySurplusSnapshot } from './entities/levy-surplus-snapshot.entity.js';
import { LevyTransferDocument } from './entities/levy-transfer-document.entity.js';
import { LevyTransferPreference } from './entities/levy-transfer-preference.entity.js';
import { LevyTransferSignature } from './entities/levy-transfer-signature.entity.js';
import { LevyTransfer } from './entities/levy-transfer.entity.js';
import { LevyWaitingPoolEntry } from './entities/levy-waiting-pool-entry.entity.js';
import { BilateralCoSignOrchestrator } from './services/bilateral-co-sign.orchestrator.js';
import { DasDonorLinkService } from './services/das-donor-link.service.js';
import { DasDonorOAuthService } from './services/das-donor-oauth.service.js';
import { DasDonorSyncService } from './services/das-donor-sync.service.js';
import { LevyEligibilityService } from './services/levy-eligibility.service.js';
import { LevyExpiryAlertService } from './services/levy-expiry-alert.service.js';
import { LevyMatchApplicationService } from './services/levy-match-application.service.js';
import { LevyMatchingService } from './services/levy-matching.service.js';
import { LevyRecipientProfileService } from './services/levy-recipient-profile.service.js';
import { LevySurplusService } from './services/levy-surplus.service.js';
import { LevyTransferPreferenceService } from './services/levy-transfer-preference.service.js';
import { LevyTransferService } from './services/levy-transfer.service.js';
import { TokenEncryptionService } from './services/token-encryption.service.js';

@Module({
  imports: [
    DasModule,
    AuthModule,
    EmailModule,
    NotificationsModule,
    EsignatureModule,
    PdfModule,
    StorageModule,
    TypeOrmModule.forFeature([
      DasDonorLink,
      DasDonorOAuthToken,
      DasLevyTranche,
      LevySurplusSnapshot,
      LevyExpiryAlertDispatch,
      LevyRecipientProfile,
      LevyTransferPreference,
      LevyMatchApplication,
      LevyWaitingPoolEntry,
      LevyTransfer,
      LevyTransferDocument,
      LevyTransferSignature,
      Organisation,
      OrganisationMembership,
      PdfGenerationJob,
    ]),
  ],
  controllers: [
    DonorLinksController,
    DonorOAuthController,
    EligibilityController,
    RecipientProfileController,
    TransferPreferencesController,
    SurplusController,
    MatchingController,
    MatchApplicationsController,
    TransfersController,
  ],
  providers: [
    TokenEncryptionService,
    DasDonorOAuthService,
    DasDonorLinkService,
    DasDonorSyncService,
    LevySurplusService,
    LevyExpiryAlertService,
    LevyEligibilityService,
    LevyRecipientProfileService,
    LevyTransferPreferenceService,
    LevyMatchingService,
    LevyMatchApplicationService,
    BilateralCoSignOrchestrator,
    LevyTransferService,
  ],
  exports: [
    TypeOrmModule,
    DasDonorLinkService,
    DasDonorSyncService,
    DasDonorOAuthService,
    TokenEncryptionService,
    LevySurplusService,
    LevyExpiryAlertService,
    LevyTransferService,
  ],
})
export class LevyExchangeModule {}
