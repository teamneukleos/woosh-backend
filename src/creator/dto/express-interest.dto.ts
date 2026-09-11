import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class ExpressInterestDto {
  @ApiPropertyOptional({
    description: 'Defaults to X-Brand-Id when omitted.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  brandId?: string;

  @ApiPropertyOptional()
  @ValidateIf((body: ExpressInterestDto) => !body.creatorProfileId)
  @IsString()
  @MinLength(1)
  prospectId?: string;

  @ApiPropertyOptional()
  @ValidateIf((body: ExpressInterestDto) => !body.prospectId)
  @IsString()
  @MinLength(1)
  creatorProfileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
