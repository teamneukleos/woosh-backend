import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class SubmitDraftDto {
  @ApiProperty({ example: 'https://drive.google.com/file/d/draft' })
  @IsUrl({ require_tld: false })
  draftUrl!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class UploadDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class RevisionDto {
  @ApiProperty({ example: 'Please crop tighter on the product shot.' })
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reviewNotes!: string;
}

export class LiveUrlDto {
  @ApiProperty({ example: 'https://instagram.com/reel/abc' })
  @IsUrl({ require_tld: false })
  liveUrl!: string;
}

export class ApproveDeliverableDto {
  @ApiPropertyOptional({ example: 'https://instagram.com/reel/abc' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  liveUrl?: string;
}

export class SendMessageDto {
  @ApiProperty({ example: 'Draft is up — take a look when you can.' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
