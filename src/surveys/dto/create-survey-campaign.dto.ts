import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SurveyRecipientDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(320)
  contactEmail!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Links the response to a known employer. Optional — a survey may go to ' +
      'a contact who is not yet an organisation on the platform.',
  })
  @IsOptional()
  @IsUUID()
  employerOrganisationId?: string;
}

export class CreateSurveyCampaignDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  templateId!: string;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'When the survey stops accepting responses. Results unlock 24 hours ' +
      'later (AC4).',
  })
  @IsDateString()
  closesAt!: string;

  @ApiProperty({ type: [SurveyRecipientDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SurveyRecipientDto)
  recipients!: SurveyRecipientDto[];
}
