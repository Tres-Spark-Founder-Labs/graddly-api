import { ApiProperty } from '@nestjs/swagger';

import { ParticipantUserOptionDto } from './participant-user-option.dto.js';

export class EnrolmentParticipantOptionsResponseDto {
  @ApiProperty({
    type: [ParticipantUserOptionDto],
    description:
      'Platform users matching the apprentice record email (invited learner)',
  })
  apprenticeCandidates!: ParticipantUserOptionDto[];

  @ApiProperty({
    type: [ParticipantUserOptionDto],
    description:
      'Active members of the provider organisation (tutor assignment)',
  })
  tutors!: ParticipantUserOptionDto[];

  @ApiProperty({
    type: [ParticipantUserOptionDto],
    description:
      'Active members of the linked employer organisation (line manager). Empty until an employer org is linked.',
  })
  employerManagers!: ParticipantUserOptionDto[];
}
