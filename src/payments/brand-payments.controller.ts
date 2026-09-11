import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../organisation/decorators/require-permission.decorator';
import { WorkspaceGuard } from '../organisation/guards/workspace.guard';
import { WorkspaceService } from '../organisation/workspace.service';
import { DocumentsService } from './documents.service';
import { PayoutService } from './payout.service';

@ApiTags('payments')
@ApiBearerAuth('access-token')
@ApiHeader({ name: 'X-Brand-Id', required: false })
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('payments')
export class BrandPaymentsController {
  constructor(
    private readonly payouts: PayoutService,
    private readonly documents: DocumentsService,
    private readonly workspace: WorkspaceService,
  ) {}

  @Get()
  @RequirePermission('analytics.view')
  @ApiOperation({
    summary: 'Payment obligations for the active brand',
    description: 'One wallet and ledger per brand. Agency money never crosses Brand rows.',
  })
  async list(
    @CurrentUser() user: { id: string },
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    const id = headerBrandId || brandId;
    if (!id) throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
    await this.workspace.requireBrandAccess(user.id, id);
    return this.payouts.listBrandPayments(id);
  }

  @Get('documents')
  @RequirePermission('analytics.view')
  @ApiOperation({
    summary: 'Receipts and statements for the active brand',
    description: 'Scoped to one brand. Agency money never crosses Brand rows.',
  })
  async listDocuments(
    @CurrentUser() user: { id: string },
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    const id = headerBrandId || brandId;
    if (!id) throw new BadRequestException('Select a brand first (brandId or X-Brand-Id).');
    return this.documents.listBrand(user.id, id);
  }

  @Get('documents/:id/pdf')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download a brand receipt or creator statement as PDF' })
  async documentPdf(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const { bytes, documentNumber } = await this.documents.pdfForActor(id, user.id);
    return new StreamableFile(Buffer.from(bytes), {
      type: 'application/pdf',
      disposition: `attachment; filename="${documentNumber}.pdf"`,
    });
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'Brand receipt or creator statement snapshot' })
  document(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.documents.getForActor(id, user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Payment obligation detail' })
  get(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.payouts.getForActor(id, user.id);
  }

  @Post(':id/release')
  @RequirePermission('payments.approve')
  @ApiOperation({
    summary: 'Release a creator payout after the 72-hour window',
    description:
      'Requires APPROVED or FAILED, availableAt in the past, no open dispute, and a verified payout account. Without Paystack this marks PAID in test mode. With Paystack it starts a transfer and waits for the webhook.',
  })
  async release(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('brandId') brandId?: string,
    @Headers('x-brand-id') headerBrandId?: string,
  ) {
    const selected = headerBrandId || brandId;
    if (selected) {
      await this.workspace.requireBrandPermission(user.id, selected, 'payments.approve');
    }
    return this.payouts.initiatePayout({ obligationId: id, actorUserId: user.id });
  }
}
