import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { CreateProspectDto } from '../../creator/dto/create-prospect.dto';

export class VerifyOrganisationDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  verified!: boolean;
}

export class SetAdminDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isAdmin!: boolean;
}

export class SeedProspectsDto {
  @ApiProperty({ type: [CreateProspectDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateProspectDto)
  rows!: CreateProspectDto[];
}
