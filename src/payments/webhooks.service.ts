import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  paystackConfigured,
  verifyPaystackWebhookSignature,
} from './paystack.client';
import { PayoutService } from './payout.service';
import { WalletService } from './wallet.service';

export type PaystackWebhookPayload = {
  event: string;
  data: {
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    reason?: string;
    gateway_response?: string;
    metadata?: { brandId?: string; purpose?: string };
    transfer_code?: string;
  };
};

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly payouts: PayoutService,
    private readonly wallets: WalletService,
  ) {}

  async handlePaystack(rawBody: string, signature: string | undefined) {
    if (!paystackConfigured()) {
      throw new ServiceUnavailableException('Paystack is not configured.');
    }
    if (!verifyPaystackWebhookSignature(rawBody, signature ?? null)) {
      throw new UnauthorizedException('Invalid Paystack signature.');
    }
    let event: PaystackWebhookPayload;
    try {
      event = JSON.parse(rawBody) as PaystackWebhookPayload;
    } catch {
      throw new BadRequestException('Invalid JSON.');
    }
    if (!event?.event || !event.data || typeof event.data !== 'object') {
      throw new BadRequestException('Invalid payload.');
    }

    const eventKey = createHash('sha256').update(rawBody).digest('hex');
    const existing = await this.prisma.providerWebhookEvent.findUnique({
      where: { eventKey },
    });
    if (existing?.processedAt) {
      return { received: true, duplicate: true };
    }
    const stored =
      existing ??
      (await this.prisma.providerWebhookEvent.upsert({
        where: { eventKey },
        create: {
          provider: 'paystack',
          eventKey,
          eventType: event.event,
          reference: event.data.reference,
          payload: event as unknown as Prisma.InputJsonValue,
          signature,
        },
        update: {},
      }));
    if (stored.processedAt) {
      return { received: true, duplicate: true };
    }
    const claimed = await this.prisma.providerWebhookEvent.updateMany({
      where: {
        id: stored.id,
        processedAt: null,
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
        ],
      },
      data: { processingStartedAt: new Date(), error: null },
    });
    if (claimed.count !== 1) {
      return { received: true, processing: true };
    }
    try {
      await this.processStored(stored.id, event);
    } catch {
      throw new BadRequestException('Processing failed.');
    }
    return { received: true };
  }

  async listFailed(actorUserId: string) {
    await this.workspace.requirePlatformAdmin(actorUserId);
    return this.prisma.providerWebhookEvent.findMany({
      where: { processedAt: null, error: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        eventType: true,
        reference: true,
        error: true,
        createdAt: true,
      },
    });
  }

  async replay(id: string, actorUserId: string) {
    await this.workspace.requirePlatformAdmin(actorUserId);
    const event = await this.prisma.providerWebhookEvent.findUnique({ where: { id } });
    if (!event || event.provider !== 'paystack') {
      throw new NotFoundException('Paystack webhook event not found.');
    }
    if (event.processedAt) throw new BadRequestException('Webhook was already processed.');
    const claimed = await this.prisma.providerWebhookEvent.updateMany({
      where: {
        id: event.id,
        processedAt: null,
        OR: [
          { processingStartedAt: null },
          { processingStartedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
        ],
      },
      data: { processingStartedAt: new Date(), error: null },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('Webhook is already being processed.');
    }
    await this.processStored(event.id, event.payload as unknown as PaystackWebhookPayload);
    await this.prisma.auditEvent.create({
      data: {
        actorId: actorUserId,
        action: 'provider_webhook.replay',
        targetType: 'ProviderWebhookEvent',
        targetId: event.id,
        after: { eventType: event.eventType, reference: event.reference },
      },
    });
    return { replayed: true, id: event.id };
  }

  private async processStored(id: string, event: PaystackWebhookPayload) {
    try {
      await this.processPayload(event);
      await this.prisma.providerWebhookEvent.update({
        where: { id },
        data: { processedAt: new Date(), processingStartedAt: null, error: null },
      });
    } catch (error) {
      await this.prisma.providerWebhookEvent.update({
        where: { id },
        data: {
          processingStartedAt: null,
          error: error instanceof Error ? error.message.slice(0, 1_000) : 'Error',
        },
      });
      throw error;
    }
  }

  private async processPayload(event: PaystackWebhookPayload) {
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const brandId = event.data.metadata?.brandId;
      if (!reference || !brandId || event.data.amount == null) {
        throw new BadRequestException('Incomplete charge.success payload.');
      }
      await this.wallets.creditFromPaystack({
        reference,
        amountKobo: event.data.amount,
        brandId,
      });
    }

    if (
      event.event === 'transfer.success' ||
      event.event === 'transfer.failed' ||
      event.event === 'transfer.reversed'
    ) {
      const reference = event.data.reference;
      if (!reference) throw new BadRequestException('Missing transfer reference.');
      await this.payouts.completeFromWebhook({
        reference,
        success: event.event === 'transfer.success',
        reversed: event.event === 'transfer.reversed',
        failureReason: event.data.reason || event.data.gateway_response || event.data.status,
        amountKobo: event.data.amount,
        currency: event.data.currency,
      });
    }
  }
}
