import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SOCIAL_CHANNELS } from '../../common/taxonomy';

const emptyToUndef = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

const tagsFromForm = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
};

export class UploadCreatorImageDto {
  @ApiProperty({ enum: ['avatar', 'cover'] })
  @IsIn(['avatar', 'cover'])
  kind!: 'avatar' | 'cover';
}

export class PortfolioMetaDto {
  @ApiProperty({ example: 'Lagos skincare reel' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional()
  @Transform(emptyToUndef)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: SOCIAL_CHANNELS })
  @Transform(emptyToUndef)
  @IsOptional()
  @IsIn(SOCIAL_CHANNELS)
  channel?: (typeof SOCIAL_CHANNELS)[number];

  @ApiPropertyOptional()
  @Transform(emptyToUndef)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  campaignType?: string;

  @ApiPropertyOptional()
  @Transform(emptyToUndef)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  brandName?: string;

  @ApiPropertyOptional({ type: [String] })
  @Transform(tagsFromForm)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}

export class CreatePortfolioEmbedDto extends PortfolioMetaDto {
  @ApiProperty({ example: 'https://www.instagram.com/p/example/' })
  @IsUrl()
  url!: string;
}

export class AddCampaignContentDto {
  @ApiProperty()
  @IsString()
  submissionId!: string;

  @ApiProperty({ example: 'Campaign content' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;
}

export class ReorderPortfolioDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[];
}
