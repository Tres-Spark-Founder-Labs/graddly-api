import { Injectable } from '@nestjs/common';

import type {
  ICompaniesHouseClient,
  ICompaniesHouseCompanySnapshot,
} from './interfaces/companies-house.client.interface.js';

@Injectable()
export class CompaniesHouseNoopClient implements ICompaniesHouseClient {
  lookupCompany(
    companyNumber: string,
  ): Promise<ICompaniesHouseCompanySnapshot> {
    const normalized = companyNumber.replace(/\s/g, '').toUpperCase();
    return Promise.resolve({
      companyNumber: normalized,
      companyName: `Noop Company ${normalized}`,
      registeredOfficeAddress: {
        addressLine1: '1 Example Street',
        locality: 'London',
        postalCode: 'SW1A 1AA',
        country: 'United Kingdom',
      },
    });
  }
}
