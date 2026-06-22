import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  FlowportalRegistrationSession,
  type RegistrationStepPayload,
} from './entities/flowportal-registration-session.entity.js';
import { RegistrationSessionStatus } from './enums/registration-session-status.enum.js';
import {
  REGISTRATION_WIZARD_STEP_ORDER,
  RegistrationWizardStep,
} from './enums/registration-wizard-step.enum.js';
import {
  COMPANIES_HOUSE_CLIENT,
  REGISTRATION_SESSION_TTL_DAYS,
} from './flowportal-registration.constants.js';
import { RegistrationEmailService } from './registration-email.service.js';

import type { CreateRegistrationSessionDto } from './dto/create-registration-session.dto.js';
import type {
  CreateRegistrationSessionResponseDto,
  RegistrationSessionResponseDto,
} from './dto/registration-session-response.dto.js';
import type {
  BankDetailsStepDto,
  CompanyVerificationStepDto,
  ConsentStepDto,
  DasAccountStepDto,
  PayeReferenceStepDto,
} from './dto/registration-step.dto.js';
import type { ICompaniesHouseClient } from './interfaces/companies-house.client.interface.js';

@Injectable()
export class RegistrationSessionService {
  constructor(
    @InjectRepository(FlowportalRegistrationSession)
    private readonly sessionRepo: Repository<FlowportalRegistrationSession>,
    @Inject(COMPANIES_HOUSE_CLIENT)
    private readonly companiesHouse: ICompaniesHouseClient,
    private readonly emailService: RegistrationEmailService,
  ) {}

  async create(
    dto: CreateRegistrationSessionDto,
  ): Promise<CreateRegistrationSessionResponseDto> {
    const resumeToken = randomBytes(32).toString('base64url');
    const resumeTokenHash = this.hashToken(resumeToken);
    const expiresAt = this.computeExpiresAt();

    const stepPayload: RegistrationStepPayload = {};
    if (dto.sector || dto.region) {
      stepPayload[RegistrationWizardStep.COMPANY_VERIFICATION] = {
        ...(dto.sector ? { sector: dto.sector } : {}),
        ...(dto.region ? { region: dto.region } : {}),
      };
    }

    const session = this.sessionRepo.create({
      resumeTokenHash,
      status: RegistrationSessionStatus.IN_PROGRESS,
      currentStep: RegistrationWizardStep.COMPANY_VERIFICATION,
      contactEmail: dto.contactEmail ?? null,
      stepPayload,
      expiresAt,
      completedAt: null,
    });

    const saved = await this.sessionRepo.save(session);

    return {
      ...this.toResponse(saved),
      resumeToken,
    };
  }

  async getByToken(
    resumeToken: string,
  ): Promise<RegistrationSessionResponseDto> {
    const session = await this.loadActiveSession(resumeToken);
    return this.toResponse(session);
  }

  async saveStep(
    resumeToken: string,
    step: RegistrationWizardStep,
    data: Record<string, unknown>,
  ): Promise<RegistrationSessionResponseDto> {
    const session = await this.loadActiveSession(resumeToken);

    if (!REGISTRATION_WIZARD_STEP_ORDER.includes(step)) {
      throw new BadRequestException('Unknown wizard step');
    }

    const stepIndex = REGISTRATION_WIZARD_STEP_ORDER.indexOf(step);
    const currentIndex = REGISTRATION_WIZARD_STEP_ORDER.indexOf(
      session.currentStep,
    );

    if (stepIndex > currentIndex) {
      throw new BadRequestException(
        `Complete ${session.currentStep} before ${step}`,
      );
    }

    const validated = await this.validateStep(step, data, session);
    const stepPayload: RegistrationStepPayload = {
      ...session.stepPayload,
      [step]: validated,
    };

    session.stepPayload = stepPayload;
    this.applyDenormalisedFields(session, step, validated);

    if (stepIndex === currentIndex) {
      const next = REGISTRATION_WIZARD_STEP_ORDER[stepIndex + 1];
      if (next) {
        session.currentStep = next;
      }
    }

    const saved = await this.sessionRepo.save(session);
    return this.toResponse(saved);
  }

  async complete(resumeToken: string): Promise<RegistrationSessionResponseDto> {
    const session = await this.loadActiveSession(resumeToken);

    for (const step of REGISTRATION_WIZARD_STEP_ORDER) {
      if (!session.stepPayload[step]) {
        throw new BadRequestException(`Missing step: ${step}`);
      }
    }

    if (!session.contactEmail) {
      throw new BadRequestException(
        'contactEmail is required — provide it on the consent step',
      );
    }

    session.status = RegistrationSessionStatus.COMPLETED;
    session.completedAt = new Date();
    session.currentStep = RegistrationWizardStep.CONSENT;

    const saved = await this.sessionRepo.save(session);

    await this.emailService.sendCompletionEmail({
      to: session.contactEmail,
      companyName: session.companyName,
      sessionId: session.id,
    });

    return this.toResponse(saved);
  }

  private async validateStep(
    step: RegistrationWizardStep,
    data: Record<string, unknown>,
    session: FlowportalRegistrationSession,
  ): Promise<Record<string, unknown>> {
    switch (step) {
      case RegistrationWizardStep.COMPANY_VERIFICATION: {
        const input = data as unknown as CompanyVerificationStepDto;
        if (!input.companiesHouseNumber?.trim()) {
          throw new UnprocessableEntityException(
            'companiesHouseNumber is required',
          );
        }
        const snapshot = await this.companiesHouse.lookupCompany(
          input.companiesHouseNumber,
        );
        return {
          companiesHouseNumber: snapshot.companyNumber,
          companyName: snapshot.companyName,
          registeredOfficeAddress: snapshot.registeredOfficeAddress,
          ...(session.stepPayload[step] ?? {}),
        };
      }
      case RegistrationWizardStep.PAYE_REFERENCE: {
        const input = data as unknown as PayeReferenceStepDto;
        if (!/^\d{3}\/[A-Za-z]{2}\d{5}$/.test(input.payeReference)) {
          throw new UnprocessableEntityException(
            'payeReference must match format 123/AB45678',
          );
        }
        return { payeReference: input.payeReference.toUpperCase() };
      }
      case RegistrationWizardStep.DAS_ACCOUNT: {
        const input = data as unknown as DasAccountStepDto;
        return {
          hasDasAccount: Boolean(input.hasDasAccount),
          dasAccountCreated: Boolean(input.dasAccountCreated),
          dasReference: input.dasReference ?? null,
        };
      }
      case RegistrationWizardStep.BANK_DETAILS: {
        const input = data as unknown as BankDetailsStepDto;
        const sortCode = input.sortCode.replace(/-/g, '');
        if (!/^\d{6}$/.test(sortCode)) {
          throw new UnprocessableEntityException('sortCode must be six digits');
        }
        if (!/^\d{8}$/.test(input.accountNumber)) {
          throw new UnprocessableEntityException(
            'accountNumber must be eight digits',
          );
        }
        return {
          accountName: input.accountName.trim(),
          sortCode: `${sortCode.slice(0, 2)}-${sortCode.slice(2, 4)}-${sortCode.slice(4, 6)}`,
          accountNumber: input.accountNumber,
        };
      }
      case RegistrationWizardStep.CONSENT: {
        const input = data as unknown as ConsentStepDto;
        if (!input.levyTransferConsent || !input.dataProcessingConsent) {
          throw new UnprocessableEntityException(
            'Both consent flags must be accepted',
          );
        }
        if (input.contactEmail) {
          session.contactEmail = input.contactEmail;
        }
        return {
          levyTransferConsent: true,
          dataProcessingConsent: true,
          signatoryName: input.signatoryName.trim(),
        };
      }
      default:
        throw new BadRequestException('Unknown wizard step');
    }
  }

  private applyDenormalisedFields(
    session: FlowportalRegistrationSession,
    step: RegistrationWizardStep,
    validated: Record<string, unknown>,
  ): void {
    if (step === RegistrationWizardStep.COMPANY_VERIFICATION) {
      session.companiesHouseNumber =
        (validated.companiesHouseNumber as string) ?? null;
      session.companyName = (validated.companyName as string) ?? null;
    }
    if (step === RegistrationWizardStep.PAYE_REFERENCE) {
      session.payeReference = (validated.payeReference as string) ?? null;
    }
  }

  private async loadActiveSession(
    resumeToken: string,
  ): Promise<FlowportalRegistrationSession> {
    const hash = this.hashToken(resumeToken);
    const session = await this.sessionRepo.findOne({
      where: { resumeTokenHash: hash, isDeleted: false },
    });

    if (!session) {
      throw new NotFoundException('Registration session not found');
    }

    if (session.status === RegistrationSessionStatus.COMPLETED) {
      return session;
    }

    if (
      session.status === RegistrationSessionStatus.EXPIRED ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      if (session.status !== RegistrationSessionStatus.EXPIRED) {
        session.status = RegistrationSessionStatus.EXPIRED;
        await this.sessionRepo.save(session);
      }
      throw new GoneException('Registration session has expired');
    }

    return session;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private computeExpiresAt(): Date {
    const expiresAt = new Date();
    expiresAt.setUTCDate(
      expiresAt.getUTCDate() + REGISTRATION_SESSION_TTL_DAYS,
    );
    return expiresAt;
  }

  private toResponse(
    session: FlowportalRegistrationSession,
  ): RegistrationSessionResponseDto {
    return {
      sessionId: session.id,
      status: session.status,
      currentStep: session.currentStep,
      contactEmail: session.contactEmail,
      stepPayload: this.redactStepPayload(session.stepPayload),
      expiresAt: session.expiresAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
    };
  }

  private redactStepPayload(
    payload: RegistrationStepPayload,
  ): Record<string, unknown> {
    const clone = JSON.parse(
      JSON.stringify(payload),
    ) as RegistrationStepPayload;
    const bank = clone[RegistrationWizardStep.BANK_DETAILS];
    if (bank && typeof bank.accountNumber === 'string') {
      bank.accountNumber = `****${bank.accountNumber.slice(-4)}`;
    }
    return clone;
  }
}
