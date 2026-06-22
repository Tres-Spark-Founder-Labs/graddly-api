import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { InterventionActionType } from '../enums/intervention-action-type.enum.js';

export class CreateInterventionActionDto {
  @ApiProperty({
    enum: InterventionActionType,
    example: InterventionActionType.CONTACT_MADE,
  })
  @IsEnum(InterventionActionType)
  actionType!: InterventionActionType;

  @ApiPropertyOptional({
    description: 'Optional free-text notes about the intervention',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
