import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ContentLanguage,
  CreatorTier,
  VerificationStatus,
} from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class OnboardCreatorDto {
  @ApiProperty({ example: 'Ada Creates' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  displayName: string;

  @ApiProperty({ example: 'Lagos' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  locationState: string;

  @ApiPropertyOptional({ example: 'Ikeja' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  locationCity?: string;

  @ApiPropertyOptional({ example: 'Lagos food & lifestyle creator' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ enum: CreatorTier, default: CreatorTier.NANO })
  @IsOptional()
  @IsEnum(CreatorTier)
  tier?: CreatorTier;

  @ApiPropertyOptional({ enum: ContentLanguage, default: ContentLanguage.EN })
  @IsOptional()
  @IsEnum(ContentLanguage)
  primaryLanguage?: ContentLanguage;

  @ApiPropertyOptional({
    enum: ContentLanguage,
    isArray: true,
    example: [ContentLanguage.EN, ContentLanguage.PIDGIN],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ContentLanguage, { each: true })
  languages?: ContentLanguage[];

  @ApiPropertyOptional({
    description: 'Referral code from another creator',
    example: 'KR1A2B3C4D',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  referredByCode?: string;
}

export class CreatorResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ nullable: true })
  bio: string | null;

  @ApiProperty()
  locationState: string;

  @ApiProperty({ nullable: true })
  locationCity: string | null;

  @ApiProperty({ enum: CreatorTier })
  tier: CreatorTier;

  @ApiProperty({ enum: ContentLanguage })
  primaryLanguage: ContentLanguage;

  @ApiProperty({ enum: VerificationStatus })
  verificationStatus: VerificationStatus;

  @ApiProperty()
  referralCode: string;

  @ApiProperty({ enum: ContentLanguage, isArray: true })
  languages: ContentLanguage[];

  @ApiProperty()
  createdAt: Date;
}
