import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class IlrReturnFileQueryDto {
  @ApiProperty({
    example: '2025-10',
    description:
      'Collection period (YYYY-MM) whose learner records make up the return.',
  })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'collectionPeriod must be YYYY-MM',
  })
  collectionPeriod!: string;
}

/**
 * The provider's whole ILR return for one collection period, as one XML
 * file for upload to ESFA Submit Learner Data.
 *
 * Returned as JSON rather than a raw XML response because the provider
 * portal reaches the API through a proxy that forwards bodies and drops
 * response headers: the filename and count the screen needs would not
 * survive in `Content-Disposition`.
 */
export class IlrReturnFileDto {
  @ApiProperty({
    example: 'ILR-10000001-2526-20251005-101500-01.XML',
    description:
      'ESFA file name: ILR-{UKPRN}-{year}-{yyyymmdd}-{hhmmss}-{serial}.XML',
  })
  filename!: string;

  @ApiProperty({ example: '10000001' })
  ukprn!: string;

  @ApiProperty({ example: '2025-26' })
  academicYear!: string;

  @ApiProperty({ example: '2025-10' })
  collectionPeriod!: string;

  @ApiProperty({
    example: 42,
    description: 'Learners in the file — every learner record in the period.',
  })
  learnerCount!: number;

  @ApiProperty({ type: [Number], example: [1] })
  mappingConfigVersions!: number[];

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({
    description:
      'What the file does and does not cover. Shown on screen and written into the file.',
  })
  coverage!: string;

  @ApiProperty({ description: 'The ILR XML file content.' })
  xml!: string;
}
