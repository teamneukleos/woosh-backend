import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CREATOR_CATEGORIES, SOCIAL_CHANNELS } from '../../common/taxonomy';

export class CreateProspectDto {
  @ApiProperty({ enum: SOCIAL_CHANNELS, example: 'TIKTOK' })
  @IsIn(SOCIAL_CHANNELS)
  channel!: (typeof SOCIAL_CHANNELS)[number];

  @ApiProperty({ example: 'someone.ng' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  handle!: string;

  @ApiPropertyOptional({ example: 'Someone' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional({ example: 'NG' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  locationCountry?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  locationCity?: string;

  @ApiPropertyOptional({ enum: CREATOR_CATEGORIES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(CREATOR_CATEGORIES, { each: true })
  categories?: string[];

  @ApiPropertyOptional({
    example: 12000,
    description: 'Ops estimate only. Labelled unverified. Never copied onto a claimed profile.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  followerEstimate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;
}
