/* eslint-disable @typescript-eslint/naming-convention -- Companies House API response shape */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  ICompaniesHouseClient,
  ICompaniesHouseCompanySnapshot,
} from './interfaces/companies-house.client.interface.js';

type CompaniesHouseApiCompany = {
  company_name?: string;
  registered_office_address?: {
    address_line_1?: string;
    address_line_2?: string;
    locality?: string;
    postal_code?: string;
    country?: string;
  };
};

@Injectable()
export class CompaniesHouseHttpClient implements ICompaniesHouseClient {
  constructor(private readonly config: ConfigService) {}

  async lookupCompany(
    companyNumber: string,
  ): Promise<ICompaniesHouseCompanySnapshot> {
    const apiKey = this.config.get<string>(
      'app.flowportalRegistration.companiesHouseApiKey',
      '',
    );
    if (!apiKey?.trim()) {
      throw new UnprocessableEntityException(
        'Companies House integration is not configured',
      );
    }

    const normalized = companyNumber.replace(/\s/g, '').toUpperCase();
    const url = `https://api.company-information.service.gov.uk/company/${encodeURIComponent(normalized)}`;
    const auth = Buffer.from(`${apiKey}:`).toString('base64');

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Basic ${auth}` },
      });
    } catch {
      throw new UnprocessableEntityException(
        'Unable to reach Companies House — try again later',
      );
    }

    if (response.status === 404) {
      throw new UnprocessableEntityException(
        'Company number not found at Companies House',
      );
    }

    if (!response.ok) {
      throw new UnprocessableEntityException(
        'Companies House lookup failed — verify the company number',
      );
    }

    const body = (await response.json()) as CompaniesHouseApiCompany;
    const address = body.registered_office_address ?? {};

    return {
      companyNumber: normalized,
      companyName: body.company_name ?? normalized,
      registeredOfficeAddress: {
        addressLine1: address.address_line_1 ?? '',
        addressLine2: address.address_line_2 ?? null,
        locality: address.locality ?? null,
        postalCode: address.postal_code ?? null,
        country: address.country ?? null,
      },
    };
  }
}
