import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsString, Max, Min, MinLength } from 'class-validator';

export class WalletTopUpDto {
  @ApiProperty({ example: 500000, description: 'Amount in NGN major units' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50_000_000)
  amount!: number;
}

export class VerifyTopUpDto {
  @ApiProperty({ example: 'fund_abc123_def45678' })
  @IsString()
  @MinLength(8)
  reference!: string;
}
