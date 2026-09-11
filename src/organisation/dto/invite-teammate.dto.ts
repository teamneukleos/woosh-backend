import { ApiProperty } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { IsEmail, IsIn } from 'class-validator';

export const ASSIGNABLE_ROLES = [
  MembershipRole.ADMIN,
  MembershipRole.MANAGER,
  MembershipRole.ACCOUNT_MANAGER,
  MembershipRole.FINANCE,
  MembershipRole.VIEWER,
] as const;

export class InviteTeammateDto {
  @ApiProperty({ example: 'colleague@brand.ng' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES, example: MembershipRole.MANAGER })
  @IsIn(ASSIGNABLE_ROLES)
  role!: (typeof ASSIGNABLE_ROLES)[number];
}
