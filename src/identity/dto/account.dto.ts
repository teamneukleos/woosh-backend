import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class NotificationPreferencesDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  emailNotifications!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  weeklyDigest!: boolean;
}

export class MarkNotificationsReadDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];
}
