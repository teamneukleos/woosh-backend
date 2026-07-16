import { ApiProperty } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty({
    example: 'If that email exists, we sent a password reset link',
  })
  message: string;
}
