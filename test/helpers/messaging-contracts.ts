export function expectMessageThreadResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      organisationId: expect.any(String),
      enrolmentId: expect.any(String),
      apprenticeId: expect.any(String),
      counterpartyParty: expect.stringMatching(/^(tutor|employer_manager)$/),
      apprenticeUserId: expect.any(String),
      counterpartyUserId: expect.any(String),
      unreadCount: expect.any(Number),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  );
}

export function expectMessageResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      threadId: expect.any(String),
      senderUserId: expect.any(String),
      body: expect.any(String),
      attachments: expect.any(Array),
      createdAt: expect.any(String),
    }),
  );
}

export function expectPresignedUploadResource(data: unknown): void {
  expect(data).toEqual(
    expect.objectContaining({
      key: expect.any(String),
      uploadUrl: expect.any(String),
      expiresAt: expect.any(String),
    }),
  );
}
