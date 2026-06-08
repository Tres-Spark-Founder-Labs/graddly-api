import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ActiveOrganisationMeDto } from '../../auth/dto/active-organisation-context.dto.js';
import { OrganisationListItemDto } from '../../organisations/dto/organisation-list-item.dto.js';
import { UserGender } from '../enums/user-gender.enum.js';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: 'Dr', nullable: true })
  title!: string | null;

  @ApiProperty({ example: 'Jane' })
  firstName!: string;

  @ApiProperty({ example: 'Smith' })
  lastName!: string;

  @ApiProperty({ example: 'jane@example.com' })
  email!: string;

  @ApiProperty({ example: false })
  isEmailVerified!: boolean;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    nullable: true,
  })
  avatarUrl!: string | null;

  @ApiPropertyOptional({ example: '+44 7700 900123', nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ example: '1990-06-15', nullable: true })
  dateOfBirth!: Date | null;

  @ApiPropertyOptional({ enum: UserGender, nullable: true })
  gender!: UserGender | null;

  @ApiPropertyOptional({ example: 'Senior Training Manager', nullable: true })
  jobTitle!: string | null;

  @ApiPropertyOptional({ example: 'People & Development', nullable: true })
  department!: string | null;

  @ApiPropertyOptional({
    example: 'Specialist in adult care workforce development.',
    nullable: true,
  })
  bio!: string | null;

  @ApiProperty({ example: 'en-GB' })
  locale!: string;

  @ApiProperty({ example: 'Europe/London' })
  timezone!: string;

  @ApiPropertyOptional({ nullable: true })
  lastLoginAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class MeResponseDto extends UserResponseDto {
  @ApiProperty({
    description:
      'The active organisation, resolved from the X-Organisation-Id header. ' +
      'When the header is absent/blank, this is the first recent organisation ' +
      '(role priority owner > admin > member, then earliest join date). When the ' +
      'header is a malformed (non-UUID) value, this is null. When the header is a ' +
      'valid UUID for an organisation the user does not belong to, the request is ' +
      'rejected with 403. Null when the user has no active membership.',
    nullable: true,
    type: () => ActiveOrganisationMeDto,
  })
  activeOrganisation!: ActiveOrganisationMeDto | null;

  @ApiProperty({
    description:
      'Lightweight list of every organisation the user actively belongs to, ' +
      'ordered by role priority then join date. Empty array when the user has no ' +
      'active memberships. Intended to drive an org switcher.',
    type: () => OrganisationListItemDto,
    isArray: true,
  })
  organisations!: OrganisationListItemDto[];
}
