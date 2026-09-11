import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';

export class InsightsQueryDto {
  @ApiPropertyOptional({ enum: [7, 30, 90], default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsIn([7, 30, 90])
  days?: number;
}

export class LogCampaignMetricDto {
  @ApiPropertyOptional({ example: 'manual' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;

  @ApiPropertyOptional({ example: 'https://instagram.com/reel/abc' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  postUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  reach?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  impressions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  views?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  engagement?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  creatorProfileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliverableId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  submissionId?: string;
}
