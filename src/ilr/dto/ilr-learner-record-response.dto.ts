import { ApiProperty } from '@nestjs/swagger';

import { IlrLearnerRecordStatus } from '../enums/ilr-learner-record-status.enum.js';

import type {
  IlrFieldMap,
  IlrValidationSummary,
} from '../types/ilr-mapping-config.types.js';

export class IlrLearnerRecordResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organisationId!: string;

  @ApiProperty({ format: 'uuid' })
  enrolmentId!: string;

  @ApiProperty({ format: 'uuid' })
  apprenticeId!: string;

  @ApiProperty({ example: '2025-10' })
  collectionPeriod!: string;

  @ApiProperty({ example: '2025-26' })
  academicYear!: string;

  @ApiProperty({ format: 'uuid' })
  mappingConfigId!: string;

  @ApiProperty()
  mappingConfigVersion!: number;

  @ApiProperty()
  fields!: IlrFieldMap;

  @ApiProperty()
  manualOverrides!: Record<string, string>;

  @ApiProperty({ enum: IlrLearnerRecordStatus })
  status!: IlrLearnerRecordStatus;

  @ApiProperty({ nullable: true })
  lastValidatedAt!: string | null;

  @ApiProperty({ nullable: true })
  validationSummary!: IlrValidationSummary | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
