import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BreakInLearningResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ format: 'date' })
  startedOn!: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  expectedReturnDate!: string | null;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  actualReturnDate!: string | null;

  @ApiProperty({
    description: 'False once the learner has returned.',
  })
  active!: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description:
      'When the ILR push was queued — not when the ESFA accepted it, which ' +
      'the push record tracks separately.',
  })
  dasNotifiedAt!: string | null;
}
