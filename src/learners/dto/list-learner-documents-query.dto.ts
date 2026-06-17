import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ListLearnerDocumentsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Filter to a single enrolment. Must belong to the authenticated apprentice user.',
  })
  @IsOptional()
  @IsUUID()
  enrolmentId?: string;
}
