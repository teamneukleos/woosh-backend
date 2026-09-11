import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BRAND_INDUSTRIES } from '../../common/taxonomy';

export class UpdateOrganisationDto {
  @ApiPropertyOptional({ example: 'Northstar Agency' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  publicName?: string;

  @ApiPropertyOptional({ example: 'https://northstar.ng' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  @ApiPropertyOptional({ enum: [...BRAND_INDUSTRIES, ''], example: 'FMCG' })
  @IsOptional()
  @IsIn([...BRAND_INDUSTRIES, ''])
  industry?: string;
}
