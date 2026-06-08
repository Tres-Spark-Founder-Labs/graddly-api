import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class BuildIlrLearnerRecordDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  enrolmentId!: string;

  @ApiProperty({ example: '2025-10' })
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  collectionPeriod!: string;

  @ApiProperty({ example: '2025-26' })
  @IsString()
  @MaxLength(9)
  @Matches(/^\d{4}-\d{2}$/)
  academicYear!: string;
}
