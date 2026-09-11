import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class SavePayoutAccountDto {
  @ApiProperty({ example: '058', description: 'Nigerian bank code' })
  @IsString()
  @MaxLength(10)
  bankCode!: string;

  @ApiProperty({ example: '0123456789', description: '10-digit NUBAN. Never returned in full after save.' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Enter a valid 10-digit NUBAN account number' })
  accountNumber!: string;
}
