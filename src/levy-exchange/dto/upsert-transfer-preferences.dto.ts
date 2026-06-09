import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpsertTransferPreferencesDto {
  @ApiProperty({ type: [String], example: ['construction', 'engineering'] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  sectors!: string[];

  @ApiProperty({ type: [String], example: ['north_west', 'yorkshire'] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  regions!: string[];

  @ApiProperty({ type: [String], example: ['10_49', '50_249'] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  sizeBands!: string[];

  @ApiProperty({ type: [String], example: ['standards', 'frameworks'] })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  programmeTypes!: string[];

  @ApiPropertyOptional({ nullable: true, example: '25000.00' })
  @IsOptional()
  @IsNumberString()
  maxPerRecipient?: string | null;

  @ApiProperty({ default: false })
  @IsBoolean()
  openMatching!: boolean;

  @ApiProperty({ default: false })
  @IsBoolean()
  anonymousMatching!: boolean;
}
