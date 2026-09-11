import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@ApiExcludeController()
@Controller('payments/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('paystack')
  @HttpCode(200)
  @ApiOperation({ summary: 'Paystack HMAC webhook' })
  handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const rawBody = req.rawBody?.toString('utf8');
    if (!rawBody) {
      throw new UnauthorizedException('Missing raw webhook body.');
    }
    return this.webhooks.handlePaystack(rawBody, signature);
  }
}
