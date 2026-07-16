import { IsEmail, IsEnum, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IntendedRole } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'ada@kreate.ng' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Ada' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Okonkwo' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'SecurePass1!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({
    enum: ['CREATOR', 'BRAND'],
    example: 'CREATOR',
    description:
      'Top-level side chosen at signup: CREATOR (nano/micro influencers) or BRAND (brand marketers, SME owners, and agencies). Persona details are collected during onboarding.',
  })
  @IsEnum(IntendedRole)
  intendedRole: IntendedRole;
}
