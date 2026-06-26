import { ApiProperty } from '@nestjs/swagger';

export class ParticipantUserOptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Jane' })
  firstName!: string;

  @ApiProperty({ example: 'Smith' })
  lastName!: string;

  @ApiProperty({ example: 'jane.smith@example.com' })
  email!: string;

  @ApiProperty({
    example: 'Jane Smith (jane.smith@example.com)',
    description: 'Human-readable label for selectors',
  })
  displayName!: string;
}
