import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BrandIndustry,
  BrandMemberRole,
  BrandServiceMode,
  BrandStatus,
} from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class OnboardBrandDto {
  @ApiProperty({ example: 'Neukleos Media' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    example: 'neukleos-media',
    description: 'URL slug; auto-generated from name if omitted',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  slug?: string;

  @ApiProperty({ enum: BrandIndustry, example: BrandIndustry.FASHION })
  @IsEnum(BrandIndustry)
  industry: BrandIndustry;

  @ApiProperty({ example: 'billing@brand.ng' })
  @IsEmail()
  billingEmail: string;

  @ApiPropertyOptional({ example: 'https://brand.ng' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({
    enum: BrandServiceMode,
    default: BrandServiceMode.MANAGED,
    description:
      'MANAGED = agency/Neukleos-assisted (Phase 1 default). SELF_SERVE = SME / direct brand portal.',
  })
  @IsOptional()
  @IsEnum(BrandServiceMode)
  serviceMode?: BrandServiceMode;

  @ApiProperty({
    enum: ['OWNER', 'AGENCY'],
    example: 'OWNER',
    description:
      'Brand-side persona on this brand: OWNER = brand marketer / SME owning the brand account; AGENCY = agency campaign manager working on behalf of the brand.',
  })
  @IsIn(['OWNER', 'AGENCY'])
  memberRole: 'OWNER' | 'AGENCY';
}

export class BrandMembershipResponseDto {
  @ApiProperty()
  brandId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty({ enum: BrandIndustry })
  industry: BrandIndustry;

  @ApiProperty({ enum: BrandStatus })
  status: BrandStatus;

  @ApiProperty({ enum: BrandServiceMode })
  serviceMode: BrandServiceMode;

  @ApiProperty({ enum: BrandMemberRole })
  role: BrandMemberRole;

  @ApiProperty()
  billingEmail: string;

  @ApiProperty({ nullable: true })
  website: string | null;

  @ApiProperty()
  createdAt: Date;
}
