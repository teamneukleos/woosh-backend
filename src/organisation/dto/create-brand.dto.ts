import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BRAND_INDUSTRIES } from '../../common/taxonomy';

export class CreateBrandDto {
  @ApiProperty({ example: 'Peak Milk' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ enum: BRAND_INDUSTRIES, example: 'FMCG' })
  @IsOptional()
  @IsIn(BRAND_INDUSTRIES)
  industry?: string;

  @ApiPropertyOptional({ example: 'NG' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country?: string;
}
