import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ListMessageThreadsQueryDto {
  @ApiProperty({
    format: 'uuid',
    required: false,
    description: 'Filter threads for a specific enrolment',
  })
  @IsOptional()
  @IsUUID()
  enrolmentId?: string;

  @ApiProperty({
    format: 'uuid',
    required: false,
    description: 'Filter threads for a specific apprentice',
  })
  @IsOptional()
  @IsUUID()
  apprenticeId?: string;
}
