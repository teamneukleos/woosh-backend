import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class AuthorizePayoutRecoveryDto {
  @ApiProperty({
    minLength: 10,
    description:
      'Why a new transfer attempt is safe, e.g. what was checked in the Paystack dashboard.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
