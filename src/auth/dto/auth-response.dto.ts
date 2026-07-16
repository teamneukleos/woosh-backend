import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IntendedRole, UserStatus } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiPropertyOptional({
    enum: ['CREATOR', 'BRAND'],
    nullable: true,
    description:
      'Signup side: CREATOR or BRAND. Use when needsOnboarding is true to resume the correct form. Brand-side covers marketing managers, SME owners, and agencies.',
  })
  intendedRole: IntendedRole | null;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class MeBrandSummaryDto {
  @ApiProperty()
  brandId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  role: string;
}

export class MeResponseDto extends UserResponseDto {
  @ApiProperty({ description: 'Whether the user has a creator profile' })
  isCreator: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Creator profile id when isCreator is true',
  })
  creatorId: string | null;

  @ApiProperty({ type: MeBrandSummaryDto, isArray: true })
  brands: MeBrandSummaryDto[];

  @ApiProperty({
    description:
      'True when the user has an account but has not finished creator or brand/agency onboarding',
  })
  needsOnboarding: boolean;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
