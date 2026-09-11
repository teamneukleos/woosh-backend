import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SwitchBrandDto {
  @ApiProperty({ example: 'clxxxxxxxx' })
  @IsString()
  @MinLength(1)
  brandId!: string;
}
