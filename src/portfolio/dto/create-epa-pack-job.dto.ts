import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateEpaPackJobDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Enrolment to compile into the EPA evidence pack. Caller must be the linked apprentice or an org admin/tutor on the enrolment.',
  })
  @IsUUID()
  enrolmentId!: string;
}
