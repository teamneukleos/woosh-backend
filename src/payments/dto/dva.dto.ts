import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateDvaDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  lastName!: string;

  @ApiProperty({ example: '08012345678' })
  @IsString()
  @MinLength(10)
  phone!: string;

  @ApiProperty({ description: 'Required. DVA is created in this person\'s name.' })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  consent!: boolean;

  @ApiPropertyOptional({ description: '11-digit BVN. Never stored.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/)
  bvn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(10, 10)
  accountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  bankCode?: string;
}
