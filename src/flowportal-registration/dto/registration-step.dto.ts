import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CompanyVerificationStepDto {
  @ApiProperty({ example: '12345678', description: 'Companies House number' })
  @IsString()
  @MaxLength(20)
  companiesHouseNumber!: string;
}

export class PayeReferenceStepDto {
  @ApiProperty({
    example: '123/AB45678',
    description: 'UK PAYE reference (office number / employer reference)',
  })
  @IsString()
  @MaxLength(32)
  @Matches(/^\d{3}\/[A-Za-z]{2}\d{5}$/, {
    message: 'payeReference must match format 123/AB45678',
  })
  payeReference!: string;
}

export class DasAccountStepDto {
  @ApiProperty({
    example: false,
    description: 'Whether a DAS account already exists',
  })
  @IsBoolean()
  hasDasAccount!: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether DAS account creation is in progress',
  })
  @IsOptional()
  @IsBoolean()
  dasAccountCreated?: boolean;

  @ApiPropertyOptional({
    example: 'DAS-REF-001',
    description: 'Existing DAS reference when applicable',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dasReference?: string;
}

export class BankDetailsStepDto {
  @ApiProperty({ example: 'Example Ltd' })
  @IsString()
  @MaxLength(255)
  accountName!: string;

  @ApiProperty({ example: '12-34-56' })
  @IsString()
  @MaxLength(8)
  @Matches(/^(\d{2}-\d{2}-\d{2}|\d{6})$/, {
    message: 'sortCode must be six digits, optionally formatted XX-XX-XX',
  })
  sortCode!: string;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @MaxLength(8)
  @Matches(/^\d{8}$/, { message: 'accountNumber must be eight digits' })
  accountNumber!: string;
}

export class ConsentStepDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  levyTransferConsent!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  dataProcessingConsent!: boolean;

  @ApiProperty({ example: 'Jane Smith' })
  @IsString()
  @MaxLength(255)
  signatoryName!: string;

  @ApiPropertyOptional({ example: 'employer@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  contactEmail?: string;
}

export class UpdateRegistrationStepDto {
  @ApiProperty({
    description: 'Step-specific payload matching the :step path parameter',
    oneOf: [
      { $ref: '#/components/schemas/CompanyVerificationStepDto' },
      { $ref: '#/components/schemas/PayeReferenceStepDto' },
      { $ref: '#/components/schemas/DasAccountStepDto' },
      { $ref: '#/components/schemas/BankDetailsStepDto' },
      { $ref: '#/components/schemas/ConsentStepDto' },
    ],
  })
  data!:
    | CompanyVerificationStepDto
    | PayeReferenceStepDto
    | DasAccountStepDto
    | BankDetailsStepDto
    | ConsentStepDto;
}
