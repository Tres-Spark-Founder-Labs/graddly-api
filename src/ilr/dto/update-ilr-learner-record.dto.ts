import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateIlrLearnerRecordDto {
  @ApiProperty({
    description: 'Manual ILR field overrides keyed by Entity.Field',
    example: { ['Learner.ULN']: '1234567890' },
  })
  @IsObject()
  manualOverrides!: Record<string, string>;
}
