import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrganisationService } from './organisation.service';

@ApiTags('team')
@Controller('invites')
export class InvitePreviewController {
  constructor(private readonly organisation: OrganisationService) {}

  @Get('preview')
  @ApiOperation({
    summary: 'Public invite details',
    description: 'Email and org name for the accept page. Token stays unguessable.',
  })
  preview(@Query('token') token: string) {
    return this.organisation.previewInvite(token);
  }
}
