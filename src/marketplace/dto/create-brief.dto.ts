import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SOCIAL_CHANNELS } from '../../common/taxonomy';

export const BRIEF_DISTRIBUTIONS = ['OPEN', 'INVITE_ONLY', 'HYBRID'] as const;
export const RATE_MODES = [
  'FIXED_NON_NEGOTIABLE',
  'FIXED_NEGOTIABLE',
  'RANGE_NEGOTIABLE',
  'DELIVERABLE_BASED',
  'CREATOR_BUNDLE',
] as const;

export class CreateBriefDto {
  @ApiPropertyOptional({ description: 'Defaults to X-Brand-Id' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  brandId?: string;

  @ApiProperty({ example: 'Lagos launch reels' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Three Instagram reels for the June launch in Lagos.' })
  @IsString()
  @MinLength(10)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  objective?: string;

  @ApiPropertyOptional({ example: 'Beauty' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiPropertyOptional({ enum: BRIEF_DISTRIBUTIONS, example: 'OPEN' })
  @IsOptional()
  @IsIn(BRIEF_DISTRIBUTIONS)
  distribution?: (typeof BRIEF_DISTRIBUTIONS)[number];

  @ApiPropertyOptional({ enum: RATE_MODES, example: 'FIXED_NON_NEGOTIABLE' })
  @IsOptional()
  @IsIn(RATE_MODES)
  rateMode?: (typeof RATE_MODES)[number];

  @ApiPropertyOptional({ example: 150000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rateAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rateMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  rateMax?: number;

  @ApiPropertyOptional({ example: 'NGN' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ enum: SOCIAL_CHANNELS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(SOCIAL_CHANNELS, { each: true })
  channels?: (typeof SOCIAL_CHANNELS)[number][];

  @ApiPropertyOptional({
    example: [{ title: 'Primary reel', channel: 'INSTAGRAM' }],
  })
  @IsOptional()
  @IsArray()
  deliverables?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  applicationDeadline?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxCreators?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  eligibility?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  rights?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  timing?: Record<string, unknown>;
}
