import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { CREATOR_CATEGORIES, SOCIAL_CHANNELS } from '../../common/taxonomy';

export class DiscoveryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: SOCIAL_CHANNELS })
  @IsOptional()
  @IsIn(SOCIAL_CHANNELS)
  channel?: (typeof SOCIAL_CHANNELS)[number];

  @ApiPropertyOptional({ enum: CREATOR_CATEGORIES })
  @IsOptional()
  @IsIn(CREATOR_CATEGORIES)
  category?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean()
  claimedOnly?: boolean;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean()
  prospectOnly?: boolean;

  @ApiPropertyOptional({ example: 'NG' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minFollowers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minEngagement?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minAverageViews?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxRate?: number;

  @ApiPropertyOptional({ enum: ['newest', 'followers', 'engagement', 'views', 'price'] })
  @IsOptional()
  @IsIn(['newest', 'followers', 'engagement', 'views', 'price'])
  sort?: 'newest' | 'followers' | 'engagement' | 'views' | 'price';
}
