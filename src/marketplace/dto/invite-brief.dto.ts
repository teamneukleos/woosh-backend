import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class InviteToBriefDto {
  @ApiPropertyOptional()
  @ValidateIf((body: InviteToBriefDto) => !body.prospectId?.trim())
  @IsString()
  @MinLength(1)
  creatorProfileId?: string;

  @ApiPropertyOptional({
    description: 'Unclaimed discovery prospect. They must claim and finish profile setup before applying.',
  })
  @ValidateIf((body: InviteToBriefDto) => !body.creatorProfileId?.trim())
  @IsString()
  @MinLength(1)
  prospectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
