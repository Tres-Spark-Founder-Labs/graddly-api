export interface ICompaniesHouseCompanySnapshot {
  companyNumber: string;
  companyName: string;
  registeredOfficeAddress: {
    addressLine1: string;
    addressLine2?: string | null;
    locality?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
}

export interface ICompaniesHouseClient {
  lookupCompany(companyNumber: string): Promise<ICompaniesHouseCompanySnapshot>;
}
