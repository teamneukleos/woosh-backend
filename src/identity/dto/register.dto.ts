import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

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

  @ApiProperty({ example: 'password123', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
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
