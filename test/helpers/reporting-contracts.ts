export function expectLevyRoiReportResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      organisationId: expect.any(String),
      totalLevySpendToDate: expect.any(Number),
      activeApprenticeCount: expect.any(Number),
      completionCount: expect.any(Number),
      epaPassRate: null,
      monthlyContributions: expect.any(Array),
      forecast: expect.objectContaining({
        activeEnrolmentCount: expect.any(Number),
        projectedMonthlySpend: expect.any(Number),
      }),
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    }),
  );
}

export function expectLevyRoiBreakdownEntryResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      groupId: expect.any(String),
      label: expect.any(String),
      activeApprenticeCount: expect.any(Number),
      completionCount: expect.any(Number),
    }),
  );
}

export function expectEmployerDirectoryEntryResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      employerOrganisationId: expect.any(String),
      organisationName: expect.any(String),
      contactEmail: expect.any(String),
      activeLearnerCount: expect.any(Number),
      commitmentPipelineStatus: expect.any(String),
      lastVisitDate: null,
    }),
  );
}
