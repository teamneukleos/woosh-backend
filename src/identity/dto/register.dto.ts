import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const PASSWORD_COMPLEXITY =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/;

export const ACCOUNT_TYPES = ['creator', 'brand', 'agency'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export class RegisterDto {
  @ApiProperty({ example: 'Ada Okonkwo' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'ada@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'Password1!',
    minLength: 8,
    description:
      '8–128 characters with an uppercase letter, a number, and a special character.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_COMPLEXITY, {
    message:
      'Password must include an uppercase letter, a number, and a special character.',
  })
  password!: string;

  @ApiPropertyOptional({
    description: 'Team invite token. Joins that organisation instead of creating a new seat.',
  })
  @IsOptional()
  @IsString()
  inviteToken?: string;

  @ApiProperty({ enum: ACCOUNT_TYPES, example: 'creator', required: false })
  @ValidateIf((body: RegisterDto) => !body.inviteToken?.trim())
  @IsIn(ACCOUNT_TYPES)
  accountType?: AccountType;
}
