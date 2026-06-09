import { ApiProperty } from '@nestjs/swagger';

export class ErasureResponseDto {
  @ApiProperty({ example: 'user' })
  subjectType!: string;

  @ApiProperty({ format: 'uuid' })
  subjectId!: string;

  @ApiProperty({ example: ['firstName', 'lastName', 'email'] })
  anonymisedFields!: string[];

  @ApiProperty({ example: 12 })
  auditRowsScrubbed!: number;

  @ApiProperty({ example: false })
  alreadyErased!: boolean;
}
