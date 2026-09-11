import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SOCIAL_CHANNELS } from '../../common/taxonomy';

export class ConnectSocialDto {
  @ApiProperty({ enum: SOCIAL_CHANNELS, example: 'INSTAGRAM' })
  @IsIn(SOCIAL_CHANNELS)
  channel!: (typeof SOCIAL_CHANNELS)[number];

  @ApiPropertyOptional({
    example: 'ada.creates',
    description: 'Handle is reserved as PENDING. OAuth must verify before metrics are live. Never send a follower count.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  handleHint?: string;
}
