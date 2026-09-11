import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DeliverablesService } from './deliverables.service';
import {
  LiveUrlDto,
  RevisionDto,
  SubmitDraftDto,
  ApproveDeliverableDto,
  UploadDraftDto,
} from './dto/work.dto';

function requireFile(file?: Express.Multer.File) {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Choose a file');
  }
  return file;
}

@ApiTags('deliverables')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('deliverables')
export class DeliverablesController {
  constructor(private readonly deliverables: DeliverablesService) {}

  @Post(':id/start')
  @ApiOperation({ summary: 'Creator starts a deliverable (NOT_STARTED → IN_PROGRESS)' })
  start(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.deliverables.start(user.id, id);
  }

  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100_000_000 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a draft file to Cloudinary and submit it',
    description: 'Image, video, or PDF up to 100 MB. Stored on Cloudinary when configured.',
  })
  upload(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: UploadDraftDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.deliverables.uploadDraft(user.id, id, requireFile(file), body.notes);
  }

  @Post(':id/submit')
  @ApiOperation({
    summary: 'Creator submits a draft URL',
    description: 'IN_PROGRESS → DRAFT_SUBMITTED, or REVISION_REQUESTED → RESUBMITTED.',
  })
  submit(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: SubmitDraftDto,
  ) {
    return this.deliverables.submitDraft(user.id, id, body);
  }

  @Post(':id/revision')
  @ApiOperation({ summary: 'Brand requests a revision' })
  revision(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: RevisionDto,
  ) {
    return this.deliverables.requestRevision(user.id, id, body.reviewNotes);
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Brand approves a submitted draft',
    description: 'Promotes the committed wallet obligation to APPROVED (still not paid).',
  })
  approve(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: ApproveDeliverableDto,
  ) {
    return this.deliverables.approve(user.id, id, body.liveUrl);
  }

  @Post(':id/live')
  @ApiOperation({ summary: 'Creator marks approved work as live with a public URL' })
  live(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: LiveUrlDto,
  ) {
    return this.deliverables.setLive(user.id, id, body.liveUrl);
  }

  @Post(':id/complete')
  @ApiOperation({
    summary: 'Brand completes live work',
    description:
      'When the last deliverable for a participant completes, payout is held 72 hours. Paystack transfer is not wired yet.',
  })
  complete(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.deliverables.complete(user.id, id);
  }
}
