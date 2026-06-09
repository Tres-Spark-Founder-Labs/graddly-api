import { ApiProperty } from '@nestjs/swagger';

export class OtjActivityCategoryDefinitionDto {
  @ApiProperty({
    description:
      'Stable activity-type identifier for OTJ log entries. This is not the programme or course — use enrolmentId for that.',
    example: 'job_shadowing',
  })
  slug!: string;

  @ApiProperty({
    description: 'Human-readable label for apprentice portal dropdown UI.',
    example: 'Job shadowing',
  })
  label!: string;
}
