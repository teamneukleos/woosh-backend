import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SocialPlatform } from '@prisma/client';

export class AuthorizationUrlDto {
  @ApiProperty()
  authorizationUrl: string;
}

export class SocialConnectionDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: SocialPlatform })
  platform: SocialPlatform;

  @ApiProperty()
  handle: string;

  @ApiPropertyOptional({ nullable: true })
  profileUrl: string | null;

  @ApiProperty()
  followerCount: number;

  @ApiProperty()
  isPrimary: boolean;

  @ApiPropertyOptional({ nullable: true })
  lastSyncedAt: Date | null;

  @ApiProperty()
  connected: boolean;
}

export class SocialMessageDto {
  @ApiProperty()
  message: string;
}
