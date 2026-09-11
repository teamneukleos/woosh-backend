import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty({
    example: 'paste-the-token-from-the-nest-console',
    description: 'Opaque invite token logged by the API until email is wired.',
  })
  @IsString()
  @MinLength(16)
  token!: string;
}
