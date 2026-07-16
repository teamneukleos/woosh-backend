import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'ada@kreate.ng' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass1!' })
  @IsString()
  @MinLength(8)
  password: string;
}
