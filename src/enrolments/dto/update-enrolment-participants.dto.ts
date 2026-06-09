import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class UpdateEnrolmentParticipantsDto {
  @ApiProperty({
    format: 'uuid',
    required: false,
    description: 'Platform user ID for the apprentice participant',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  apprenticeUserId?: string;

  @ApiProperty({
    format: 'uuid',
    required: false,
    description: 'Platform user ID for the assigned tutor',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  @IsOptional()
  @IsUUID()
  tutorUserId?: string;

  @ApiProperty({
    format: 'uuid',
    required: false,
    description: 'Platform user ID for the employer line manager',
    example: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  })
  @IsOptional()
  @IsUUID()
  employerManagerUserId?: string;
}
