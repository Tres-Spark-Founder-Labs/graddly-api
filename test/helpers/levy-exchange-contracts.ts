/**
 * Shared shape assertions for Levy Exchange API contracts.
 */

export function expectDonorLinkResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      organisationId: expect.any(String),
      status: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  );
}

export function expectRecipientProfileResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      organisationId: expect.any(String),
      sector: expect.any(String),
      region: expect.any(String),
      employeeCountBand: expect.any(String),
      programmeType: expect.any(String),
      transferAmountRequired: expect.any(String),
      hasDasAccount: expect.any(Boolean),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  );
}

export function expectTransferPreferencesResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      organisationId: expect.any(String),
      sectors: expect.any(Array),
      regions: expect.any(Array),
      sizeBands: expect.any(Array),
      programmeTypes: expect.any(Array),
      openMatching: expect.any(Boolean),
      anonymousMatching: expect.any(Boolean),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  );
}

export function expectSurplusEntry(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      donorLinkId: expect.any(String),
      totalBalance: expect.any(String),
      maxTransferable: expect.any(String),
      availableSurplus: expect.any(String),
    }),
  );
}

export function expectMatchSearchResponse(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      matches: expect.any(Array),
      addedToWaitingPool: expect.any(Boolean),
    }),
  );
}

export function expectMatchApplicationResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      donorOrganisationId: expect.any(String),
      recipientOrganisationId: expect.any(String),
      requestedAmount: expect.any(String),
      status: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  );
}

export function expectLevyTransferResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      donorOrganisationId: expect.any(String),
      recipientOrganisationId: expect.any(String),
      matchApplicationId: expect.any(String),
      amount: expect.any(String),
      status: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  );
}

export function expectLevyTransferDocumentResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      transferId: expect.any(String),
      status: expect.any(String),
    }),
  );
}
