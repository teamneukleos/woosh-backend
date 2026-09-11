import { ApiProperty } from '@nestjs/swagger';
import { DisputeResolutionType } from '@prisma/client';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

const RESOLUTIONS = ['RELEASE_PAYOUT', 'REFUND_BRAND'] as const satisfies readonly DisputeResolutionType[];

export class ResolveDisputeDto {
  @ApiProperty({ enum: RESOLUTIONS })
  @IsIn(RESOLUTIONS)
  resolutionType!: DisputeResolutionType;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  resolution!: string;
}
