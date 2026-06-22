import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EmailModule } from '../email/email.module.js';

import { CompaniesHouseHttpClient } from './companies-house-http.client.js';
import { CompaniesHouseNoopClient } from './companies-house-noop.client.js';
import { FlowportalRegistrationSession } from './entities/flowportal-registration-session.entity.js';
import { COMPANIES_HOUSE_CLIENT } from './flowportal-registration.constants.js';
import { RegistrationEmailService } from './registration-email.service.js';
import { RegistrationSessionService } from './registration-session.service.js';
import { RegistrationWizardController } from './registration-wizard.controller.js';

import type { ICompaniesHouseClient } from './interfaces/companies-house.client.interface.js';

@Module({
  imports: [
    EmailModule,
    TypeOrmModule.forFeature([FlowportalRegistrationSession]),
  ],
  controllers: [RegistrationWizardController],
  providers: [
    RegistrationSessionService,
    RegistrationEmailService,
    CompaniesHouseNoopClient,
    CompaniesHouseHttpClient,
    {
      provide: COMPANIES_HOUSE_CLIENT,
      useFactory: (
        config: ConfigService,
        noop: CompaniesHouseNoopClient,
        http: CompaniesHouseHttpClient,
      ): ICompaniesHouseClient => {
        const apiKey = config.get<string>(
          'app.flowportalRegistration.companiesHouseApiKey',
          '',
        );
        return apiKey?.trim() ? http : noop;
      },
      inject: [
        ConfigService,
        CompaniesHouseNoopClient,
        CompaniesHouseHttpClient,
      ],
    },
  ],
})
export class FlowportalRegistrationModule {}
