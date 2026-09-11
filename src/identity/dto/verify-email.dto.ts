import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Opaque token from the Nest console log' })
  @IsString()
  @MinLength(20)
  token!: string;
}
