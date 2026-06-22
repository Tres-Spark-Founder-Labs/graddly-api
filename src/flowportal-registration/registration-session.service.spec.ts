import { createHash } from 'node:crypto';

import { GoneException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FlowportalRegistrationSession } from './entities/flowportal-registration-session.entity.js';
import { RegistrationSessionStatus } from './enums/registration-session-status.enum.js';
import { RegistrationWizardStep } from './enums/registration-wizard-step.enum.js';
import { COMPANIES_HOUSE_CLIENT } from './flowportal-registration.constants.js';
import { RegistrationEmailService } from './registration-email.service.js';
import { RegistrationSessionService } from './registration-session.service.js';

describe('RegistrationSessionService', () => {
  let service: RegistrationSessionService;

  const sessions = new Map<string, FlowportalRegistrationSession>();

  const sessionRepo = {
    create: jest.fn((input: FlowportalRegistrationSession) => input),
    save: jest.fn((input: FlowportalRegistrationSession) => {
      const saved: FlowportalRegistrationSession = {
        ...input,
        id: input.id ?? 'session-1',
        createdAt: input.createdAt ?? new Date(),
        updatedAt: new Date(),
        isDeleted: false,
        deletedAt: null,
      };
      sessions.set(saved.resumeTokenHash, saved);
      return Promise.resolve(saved);
    }),
    findOne: jest.fn(({ where }: { where: { resumeTokenHash: string } }) =>
      Promise.resolve(sessions.get(where.resumeTokenHash) ?? null),
    ),
  };

  const companiesHouse = {
    lookupCompany: jest.fn().mockResolvedValue({
      companyNumber: '12345678',
      companyName: 'Example Ltd',
      registeredOfficeAddress: {
        addressLine1: '1 Street',
        locality: 'London',
        postalCode: 'SW1A 1AA',
        country: 'United Kingdom',
      },
    }),
  };

  const emailService = {
    sendCompletionEmail: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    sessions.clear();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RegistrationSessionService,
        {
          provide: getRepositoryToken(FlowportalRegistrationSession),
          useValue: sessionRepo,
        },
        { provide: COMPANIES_HOUSE_CLIENT, useValue: companiesHouse },
        { provide: RegistrationEmailService, useValue: emailService },
      ],
    }).compile();

    service = moduleRef.get(RegistrationSessionService);
  });

  it('creates a session with resume token', async () => {
    const result = await service.create({ contactEmail: 'test@example.com' });

    expect(result.resumeToken).toBeDefined();
    expect(result.sessionId).toBe('session-1');
    expect(result.status).toBe(RegistrationSessionStatus.IN_PROGRESS);
    expect(sessionRepo.save).toHaveBeenCalled();
  });

  it('advances steps in order and completes with email', async () => {
    const created = await service.create({});
    const token = created.resumeToken;

    await service.saveStep(token, RegistrationWizardStep.COMPANY_VERIFICATION, {
      companiesHouseNumber: '12345678',
    });
    await service.saveStep(token, RegistrationWizardStep.PAYE_REFERENCE, {
      payeReference: '123/AB45678',
    });
    await service.saveStep(token, RegistrationWizardStep.DAS_ACCOUNT, {
      hasDasAccount: false,
    });
    await service.saveStep(token, RegistrationWizardStep.BANK_DETAILS, {
      accountName: 'Example Ltd',
      sortCode: '12-34-56',
      accountNumber: '12345678',
    });
    await service.saveStep(token, RegistrationWizardStep.CONSENT, {
      levyTransferConsent: true,
      dataProcessingConsent: true,
      signatoryName: 'Jane Smith',
      contactEmail: 'employer@example.com',
    });

    const completed = await service.complete(token);

    expect(completed.status).toBe(RegistrationSessionStatus.COMPLETED);
    expect(emailService.sendCompletionEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'employer@example.com' }),
    );
  });

  it('redacts bank account number on read', async () => {
    const created = await service.create({});
    const token = created.resumeToken;

    await service.saveStep(token, RegistrationWizardStep.COMPANY_VERIFICATION, {
      companiesHouseNumber: '12345678',
    });
    await service.saveStep(token, RegistrationWizardStep.PAYE_REFERENCE, {
      payeReference: '123/AB45678',
    });
    await service.saveStep(token, RegistrationWizardStep.DAS_ACCOUNT, {
      hasDasAccount: false,
    });
    await service.saveStep(token, RegistrationWizardStep.BANK_DETAILS, {
      accountName: 'Example Ltd',
      sortCode: '12-34-56',
      accountNumber: '12345678',
    });

    const session = await service.getByToken(token);
    const bank = session.stepPayload[RegistrationWizardStep.BANK_DETAILS] as {
      accountNumber: string;
    };

    expect(bank.accountNumber).toBe('****5678');
  });

  it('rejects expired sessions', async () => {
    const hash = createHash('sha256').update('expired-token').digest('hex');
    sessions.set(hash, {
      id: 'expired',
      resumeTokenHash: hash,
      status: RegistrationSessionStatus.IN_PROGRESS,
      currentStep: RegistrationWizardStep.COMPANY_VERIFICATION,
      stepPayload: {},
      contactEmail: null,
      expiresAt: new Date('2020-01-01'),
      completedAt: null,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      companiesHouseNumber: null,
      companyName: null,
      payeReference: null,
    });

    await expect(service.getByToken('expired-token')).rejects.toBeInstanceOf(
      GoneException,
    );
  });
});
