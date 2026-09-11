import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  BRAND_INDUSTRIES,
  CREATOR_CATEGORIES,
  LANGUAGES,
} from '../../common/taxonomy';

export class UpdateCreatorProfileDto {
  @ApiProperty({ example: 'Ada Creates' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ example: 'https://ada.ng' })
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  websiteUrl?: string;

  @ApiPropertyOptional({ example: 'NG' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  locationCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  locationState?: string;

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

  @ApiPropertyOptional({ enum: LANGUAGES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(LANGUAGES, { each: true })
  languages?: string[];

  @ApiPropertyOptional({ enum: BRAND_INDUSTRIES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(BRAND_INDUSTRIES, { each: true })
  preferredIndustries?: string[];

  @ApiPropertyOptional({ enum: BRAND_INDUSTRIES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(BRAND_INDUSTRIES, { each: true })
  excludedIndustries?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ageBand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ageSearchable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  genderSearchable?: boolean;

  @ApiPropertyOptional({ example: 80000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  typicalRateMin?: number;

  @ApiPropertyOptional({ example: 250000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  typicalRateMax?: number;

  @ApiPropertyOptional({ example: 'NGN' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  rateCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  availabilityNotes?: string;
}
