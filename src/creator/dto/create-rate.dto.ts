import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SOCIAL_CHANNELS } from '../../common/taxonomy';

export class CreateRatePackageDto {
  @ApiProperty({ enum: SOCIAL_CHANNELS, example: 'INSTAGRAM' })
  @IsIn(SOCIAL_CHANNELS)
  channel!: (typeof SOCIAL_CHANNELS)[number];

  @ApiProperty({ example: 'Reel' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  deliverableType!: string;

  @ApiProperty({ example: 'Instagram Reel' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 150000 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  @Max(1_000_000_000)
  price!: number;

  @ApiPropertyOptional({ example: 'NGN' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  turnaroundDays?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  revisions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  usageRights?: string;
}
