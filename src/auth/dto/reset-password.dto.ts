import { IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Raw token from the password reset email link',
    example: 'a1b2c3d4e5f6...',
  })
  @IsString()
  @MinLength(32)
  token: string;

  @ApiProperty({ example: 'NewSecurePass1!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}
