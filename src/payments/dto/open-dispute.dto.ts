import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisputeCategory } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const CATEGORIES = [
  'CONTENT_APPROVAL',
  'PAYMENT_AMOUNT',
  'PAYOUT_DELAY',
  'CANCELLATION',
  'OTHER',
] as const satisfies readonly DisputeCategory[];

export class OpenDisputeDto {
  @ApiProperty()
  @IsString()
  obligationId!: string;

  @ApiProperty({ enum: CATEGORIES })
  @IsIn(CATEGORIES)
  category!: DisputeCategory;

  @ApiProperty({ minLength: 3 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @ApiProperty({ minLength: 20 })
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  requestedResolution?: string;
}
