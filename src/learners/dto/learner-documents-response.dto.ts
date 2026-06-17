import { ApiProperty } from '@nestjs/swagger';

import { LearnerDocumentItemDto } from './learner-document-item.dto.js';

export class LearnerDocumentsEnrolmentGroupDto {
  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ type: [LearnerDocumentItemDto] })
  items!: LearnerDocumentItemDto[];
}

export class LearnerDocumentsResponseDto {
  @ApiProperty({ type: [LearnerDocumentsEnrolmentGroupDto] })
  enrolments!: LearnerDocumentsEnrolmentGroupDto[];
}
