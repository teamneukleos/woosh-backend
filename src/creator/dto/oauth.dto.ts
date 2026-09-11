import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { SOCIAL_CHANNELS } from '../../common/taxonomy';

const emptyToUndef = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

export class OAuthCallbackDto {
  @ApiProperty({ enum: SOCIAL_CHANNELS })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(SOCIAL_CHANNELS)
  channel!: (typeof SOCIAL_CHANNELS)[number];

  @ApiProperty({ required: false })
  @ValidateIf((body: OAuthCallbackDto) => !body.connectedAccountId)
  @IsString()
  @MinLength(8)
  code?: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  state!: string;

  @ApiProperty({ required: false })
  @Transform(({ obj, value }: { obj: Record<string, unknown>; value: unknown }) => {
    const raw = value ?? obj.connected_account_id;
    return typeof raw === 'string' ? raw : undefined;
  })
  @ValidateIf((body: OAuthCallbackDto) => !body.code)
  @IsString()
  @MinLength(8)
  connectedAccountId?: string;
}

export class DevOAuthDto {
  @ApiProperty({ enum: SOCIAL_CHANNELS })
  @IsIn(SOCIAL_CHANNELS)
  channel!: (typeof SOCIAL_CHANNELS)[number];

  @ApiProperty({ example: 'ada.creates' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  handle!: string;

  @ApiPropertyOptional({
    description: 'Dev-only snapshot. Never accepted on the production OAuth path.',
  })
  @Transform(emptyToUndef)
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  followers?: number;
}
