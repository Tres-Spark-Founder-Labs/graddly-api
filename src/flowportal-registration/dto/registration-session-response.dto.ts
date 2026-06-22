import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { RegistrationSessionStatus } from '../enums/registration-session-status.enum.js';
import { RegistrationWizardStep } from '../enums/registration-wizard-step.enum.js';

export class RegistrationSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({
    enum: RegistrationSessionStatus,
    example: RegistrationSessionStatus.IN_PROGRESS,
  })
  status!: RegistrationSessionStatus;

  @ApiProperty({
    enum: RegistrationWizardStep,
    example: RegistrationWizardStep.COMPANY_VERIFICATION,
  })
  currentStep!: RegistrationWizardStep;

  @ApiPropertyOptional({ example: 'employer@example.com' })
  contactEmail?: string | null;

  @ApiProperty({
    description: 'Saved step data (bank account number redacted on read)',
    type: 'object',
    additionalProperties: true,
  })
  stepPayload!: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  completedAt?: string | null;
}

export class CreateRegistrationSessionResponseDto extends RegistrationSessionResponseDto {
  @ApiProperty({
    description:
      'Opaque resume token — shown once at creation; store client-side to resume the wizard',
    example: 'dGhpcy1pcy1hbi1leGFtcGxlLXRva2Vu',
  })
  resumeToken!: string;
}
