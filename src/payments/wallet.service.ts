import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { asNumber, capacityRequired, splitFee } from '../common/fees';
import {
  assertProductionPaymentConfiguration,
  canTransitionObligation,
  payoutReleaseAt,
} from '../common/payments-policy';
import { PrismaService } from '../prisma/prisma.service';
import { notify } from './notify';
import {
  assignDedicatedVirtualAccount,
  createDedicatedVirtualAccount,
  createPaystackCustomer,
  getPaystackCustomer,
  initializeTransaction,
  PaystackError,
  paystackConfigured,
  paystackNeedsIdentification,
  paystackPublicKey,
  preferredDvaBank,
  updatePaystackCustomer,
  verifyTransaction,
} from './paystack.client';
import {
  decryptAccountNumber,
  encryptAccountNumber,
} from './payout-account-crypto';
import { WorkspaceService } from '../organisation/workspace.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}

  async getOrCreate(brandId: string, currency = 'NGN') {
    return this.prisma.brandWallet.upsert({
      where: { brandId },
      create: { brandId, balance: 0, currency },
      update: {},
    });
  }

  async getBalance(brandId: string) {
    const wallet = await this.getOrCreate(brandId);
    return {
      id: wallet.id,
      brandId,
      balance: asNumber(wallet.balance) ?? 0,
      currency: wallet.currency,
      dva: this.presentDva(wallet),
    };
  }

  presentDva(wallet: {
    dvaAccountName: string | null;
    dvaBankName: string | null;
    encryptedDvaAccountNumber: string | null;
    dvaAccountNumberLast4: string | null;
    dvaAssignedAt: Date | null;
  }) {
    if (!wallet.encryptedDvaAccountNumber) return null;
    return {
      accountName: wallet.dvaAccountName,
      bankName: wallet.dvaBankName,
      accountNumber: decryptAccountNumber(wallet.encryptedDvaAccountNumber),
      accountNumberLast4: wallet.dvaAccountNumberLast4,
      assignedAt: wallet.dvaAssignedAt,
    };
  }

  async findBrandIdForCharge(input: {
    metadata?: { brandId?: string };
    customer?: { customer_code?: string };
  }) {
    if (typeof input.metadata?.brandId === 'string' && input.metadata.brandId) {
      return input.metadata.brandId;
    }
    const code = input.customer?.customer_code?.trim();
    if (!code) return null;
    const wallet = await this.prisma.brandWallet.findUnique({
      where: { paystackCustomerCode: code },
      select: { brandId: true },
    });
    return wallet?.brandId ?? null;
  }

  async persistAssignedDva(input: {
    customerCode: string;
    accountNumber: string;
    accountName?: string;
    bankName?: string;
  }) {
    const wallet = await this.prisma.brandWallet.findUnique({
      where: { paystackCustomerCode: input.customerCode },
    });
    if (!wallet) return null;
    const accountNumber = input.accountNumber.replace(/\s/g, '');
    return this.prisma.brandWallet.update({
      where: { id: wallet.id },
      data: {
        dvaAccountName: input.accountName || wallet.dvaAccountName,
        dvaBankName: input.bankName || wallet.dvaBankName,
        encryptedDvaAccountNumber: encryptAccountNumber(accountNumber),
        dvaAccountNumberLast4: accountNumber.slice(-4),
        dvaAssignedAt: new Date(),
      },
    });
  }

  async getOrCreateDva(input: {
    brandId: string;
    actorUserId: string;
    actorEmail: string;
    firstName: string;
    lastName: string;
    phone: string;
    consent: boolean;
    bvn?: string;
    accountNumber?: string;
    bankCode?: string;
  }) {
    try {
      assertProductionPaymentConfiguration();
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Payments are not configured.',
      );
    }
    if (!input.consent) {
      throw new BadRequestException(
        'Consent is required to create a dedicated account in this name.',
      );
    }
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const phone = normalizeNgPhone(input.phone);
    if (!firstName || !lastName) {
      throw new BadRequestException('First and last name are required.');
    }
    await this.prisma.user.update({
      where: { id: input.actorUserId },
      data: { phone, name: `${firstName} ${lastName}`.trim() },
    });

    const wallet = await this.getOrCreate(input.brandId);
    if (wallet.encryptedDvaAccountNumber) {
      return { status: 'ready' as const, dva: this.presentDva(wallet) };
    }

    if (!paystackConfigured()) {
      if (process.env.NODE_ENV === 'production') {
        throw new ForbiddenException('Paystack is required for bank transfer in production.');
      }
      const accountNumber = mockDvaAccountNumber(input.brandId);
      const updated = await this.prisma.brandWallet.update({
        where: { id: wallet.id },
        data: {
          paystackCustomerCode: wallet.paystackCustomerCode ?? `test_${input.brandId}`,
          dvaAccountName: `${firstName} ${lastName}`.trim(),
          dvaBankName: 'Test Bank',
          encryptedDvaAccountNumber: encryptAccountNumber(accountNumber),
          dvaAccountNumberLast4: accountNumber.slice(-4),
          dvaAssignedAt: new Date(),
        },
      });
      return { status: 'ready' as const, dva: this.presentDva(updated) };
    }

    const customerEmail = `wallet.${input.brandId}@pay.woosh.app`;
    let customerCode = wallet.paystackCustomerCode;
    if (!customerCode) {
      let customer;
      try {
        customer = await createPaystackCustomer({
          email: customerEmail,
          firstName,
          lastName,
          phone,
          metadata: {
            brandId: input.brandId,
            actorEmail: input.actorEmail,
            purpose: 'wallet_dva',
          },
        });
      } catch (error) {
        if (
          error instanceof PaystackError &&
          error.message.toLowerCase().includes('exist')
        ) {
          customer = await getPaystackCustomer(customerEmail);
        } else {
          throw error;
        }
      }
      customerCode = customer.customer_code;
      await this.prisma.brandWallet.update({
        where: { id: wallet.id },
        data: { paystackCustomerCode: customerCode },
      });
    } else {
      await updatePaystackCustomer(customerCode, { firstName, lastName, phone });
    }

    const identifying = Boolean(
      input.bvn && input.accountNumber && input.bankCode,
    );
    try {
      if (identifying) {
        await assignDedicatedVirtualAccount({
          email: customerEmail,
          firstName,
          lastName,
          phone,
          bvn: input.bvn!,
          accountNumber: input.accountNumber!,
          bankCode: input.bankCode!,
        });
        await this.prisma.auditEvent.create({
          data: {
            actorId: input.actorUserId,
            action: 'wallet.dva.assign',
            targetType: 'BrandWallet',
            targetId: wallet.id,
            after: { brandId: input.brandId, preferredBank: preferredDvaBank() },
          },
        });
        return {
          status: 'pending' as const,
          message:
            'Paystack is assigning the account. Refresh this page in a moment, or wait for the transfer details to appear.',
          dva: null,
        };
      }

      const assigned = await createDedicatedVirtualAccount({
        customer: customerCode,
        firstName,
        lastName,
        phone,
      });
      const updated = await this.persistAssignedDva({
        customerCode,
        accountNumber: assigned.account_number,
        accountName: assigned.account_name,
        bankName: assigned.bank?.name,
      });
      await this.prisma.auditEvent.create({
        data: {
          actorId: input.actorUserId,
          action: 'wallet.dva.create',
          targetType: 'BrandWallet',
          targetId: wallet.id,
          after: { brandId: input.brandId, last4: assigned.account_number.slice(-4) },
        },
      });
      return { status: 'ready' as const, dva: updated ? this.presentDva(updated) : null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create a virtual account.';
      if (error instanceof PaystackError && paystackNeedsIdentification(message) && !identifying) {
        return {
          status: 'needs_identification' as const,
          message:
            'Paystack needs a BVN and a bank account in that BVN to name this virtual account. We do not store the BVN.',
          dva: null,
        };
      }
      throw new BadRequestException(message);
    }
  }

  async startTopUp(input: {
    brandId: string;
    amount: number;
    actorUserId: string;
    actorEmail: string;
  }) {
    try {
      assertProductionPaymentConfiguration();
    } catch (error) {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Payments are not configured.',
      );
    }
    if (input.amount <= 0) throw new BadRequestException('Amount must be positive.');
    const wallet = await this.getOrCreate(input.brandId);
    const reference = `fund_${input.brandId.slice(-8)}_${randomUUID().slice(0, 8)}`;

    if (!paystackConfigured()) {
      if (process.env.NODE_ENV === 'production') {
        throw new ForbiddenException('Paystack is required for wallet top-up in production.');
      }
      const updated = await this.prisma.brandWallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: input.amount } },
      });
      await this.prisma.ledgerTransaction.create({
        data: {
          type: 'COLLECTION',
          amount: input.amount,
          currency: wallet.currency,
          status: 'SUCCEEDED',
          provider: 'test_mode',
          providerReference: reference,
          idempotencyKey: `fund_${reference}`,
          metadata: { brandId: input.brandId, mode: 'test' },
        },
      });
      await this.prisma.auditEvent.create({
        data: {
          actorId: input.actorUserId,
          action: 'wallet.topup.test',
          targetType: 'BrandWallet',
          targetId: wallet.id,
          after: { amount: input.amount, balance: asNumber(updated.balance) },
        },
      });
      return {
        mode: 'test' as const,
        balance: asNumber(updated.balance) ?? 0,
        currency: updated.currency,
        reference,
      };
    }

    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const init = await initializeTransaction({
      email: input.actorEmail,
      amountMajor: input.amount,
      currency: wallet.currency,
      reference,
      callbackUrl: `${frontend}/api/paystack/verify`,
      metadata: {
        brandId: input.brandId,
        purpose: 'wallet_topup',
        actorUserId: input.actorUserId,
      },
    });
    await this.prisma.ledgerTransaction.create({
      data: {
        type: 'COLLECTION',
        amount: input.amount,
        currency: wallet.currency,
        status: 'PENDING',
        provider: 'paystack',
        providerReference: reference,
        idempotencyKey: `fund_${reference}`,
        metadata: { brandId: input.brandId, purpose: 'wallet_topup' },
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: input.actorUserId,
        action: 'wallet.topup.initiated',
        targetType: 'BrandWallet',
        targetId: wallet.id,
        after: { amount: input.amount, reference },
      },
    });
    return {
      mode: 'paystack' as const,
      authorizationUrl: init.authorization_url,
      reference,
      publicKey: paystackPublicKey(),
    };
  }

  async completeTopUpFromPaystack(userId: string, reference: string) {
    const charge = await verifyTransaction(reference);
    if (charge.status !== 'success') {
      throw new BadRequestException('Paystack did not confirm this payment.');
    }
    const brandId =
      typeof charge.metadata?.brandId === 'string' ? charge.metadata.brandId : '';
    if (!brandId) {
      throw new BadRequestException('This payment is missing a brand.');
    }
    if (charge.metadata?.purpose && charge.metadata.purpose !== 'wallet_topup') {
      throw new BadRequestException('This Paystack charge is not a wallet top-up.');
    }
    await this.workspace.requireBrandPermission(userId, brandId, 'payments.approve');
    return this.creditFromPaystack({
      reference: charge.reference,
      amountKobo: charge.amount,
      brandId,
    });
  }

  async creditFromPaystack(input: { reference: string; amountKobo: number; brandId: string }) {
    const existing = await this.prisma.ledgerTransaction.findFirst({
      where: { providerReference: input.reference },
    });
    if (existing?.status === 'SUCCEEDED') {
      return this.getBalance(input.brandId);
    }
    const amountMajor = input.amountKobo / 100;
    const metadata = existing?.metadata as { brandId?: string } | null;
    if (
      existing &&
      (Number(existing.amount) !== amountMajor ||
        existing.currency !== 'NGN' ||
        String(metadata?.brandId ?? '') !== input.brandId)
    ) {
      throw new BadRequestException('Paystack charge does not match the pending collection.');
    }
    const wallet = await this.getOrCreate(input.brandId);
    await this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.ledgerTransaction.update({
          where: { id: existing.id },
          data: { status: 'SUCCEEDED', completedAt: new Date() },
        });
      } else {
        await tx.ledgerTransaction.create({
          data: {
            type: 'COLLECTION',
            amount: amountMajor,
            currency: wallet.currency,
            status: 'SUCCEEDED',
            provider: 'paystack',
            providerReference: input.reference,
            idempotencyKey: `fund_${input.reference}`,
            metadata: { brandId: input.brandId },
            completedAt: new Date(),
          },
        });
      }
      await tx.brandWallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: amountMajor } },
      });
    });
    return this.getBalance(input.brandId);
  }

  async commitOnAccept(input: {
    brandId: string;
    campaignParticipantId: string;
    gross: number;
    currency: string;
    actorUserId: string;
  }) {
    const required = capacityRequired(input.gross);
    const { platformFee, net } = splitFee(input.gross);
    const wallet = await this.getOrCreate(input.brandId, input.currency);

    const obligation = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.paymentObligation.findUnique({
          where: { campaignParticipantId: input.campaignParticipantId },
        });
        if (existing) return existing;

        const current = await tx.brandWallet.findUniqueOrThrow({
          where: { id: wallet.id },
        });
        if (Number(current.balance) < required) {
          throw new BadRequestException(
            `Insufficient brand funds. Need ₦${required.toLocaleString()} (creator rate); wallet has ₦${Number(current.balance).toLocaleString()}. Top up the wallet first.`,
          );
        }

        const created = await tx.paymentObligation.create({
          data: {
            campaignParticipantId: input.campaignParticipantId,
            grossAmount: input.gross,
            platformFee,
            netAmount: net,
            currency: input.currency,
            status: 'COMMITTED',
          },
        });
        await tx.brandWallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: required } },
        });
        await tx.ledgerTransaction.create({
          data: {
            obligationId: created.id,
            type: 'ADJUSTMENT',
            amount: required,
            currency: input.currency,
            status: 'SUCCEEDED',
            provider: 'woosh_ledger',
            providerReference: `commit_${input.campaignParticipantId}`,
            idempotencyKey: `commit_${input.campaignParticipantId}`,
            completedAt: new Date(),
            metadata: {
              brandId: input.brandId,
              campaignParticipantId: input.campaignParticipantId,
              purpose: 'accept_commitment',
            } as Prisma.InputJsonValue,
          },
        });
        return created;
      },
      { isolationLevel: 'Serializable' },
    );

    await this.prisma.auditEvent.create({
      data: {
        actorId: input.actorUserId,
        action: 'payment.commit',
        targetType: 'PaymentObligation',
        targetId: obligation.id,
        after: { required, gross: input.gross, platformFee, net },
      },
    });

    return obligation;
  }

  async approveOnDeliverableApprove(campaignParticipantId: string, actorUserId: string) {
    const existing = await this.prisma.paymentObligation.findFirst({
      where: {
        campaignParticipantId,
        status: { notIn: ['REVERSED', 'FAILED', 'PAID'] },
      },
    });
    if (existing) {
        if (existing.status === 'COMMITTED' || existing.status === 'FUNDED') {
        if (!canTransitionObligation(existing.status, 'APPROVED')) {
          throw new BadRequestException(
            `Payment cannot move from ${existing.status} to APPROVED.`,
          );
        }
        const updated = await this.prisma.paymentObligation.update({
          where: { id: existing.id },
          data: { status: 'APPROVED', approvedAt: new Date() },
        });
        await this.prisma.auditEvent.create({
          data: {
            actorId: actorUserId,
            action: 'payment.obligation.approve',
            targetType: 'PaymentObligation',
            targetId: updated.id,
          },
        });
        return updated;
      }
      return existing;
    }

    const participant = await this.prisma.campaignParticipant.findUnique({
      where: { id: campaignParticipantId },
    });
    if (!participant) throw new NotFoundException('Participant not found.');
    const gross = Number(participant.agreedRate);
    const { platformFee, net } = splitFee(gross);
    const obligation = await this.prisma.paymentObligation.create({
      data: {
        campaignParticipantId: participant.id,
        grossAmount: gross,
        platformFee,
        netAmount: net,
        currency: participant.currency,
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: actorUserId,
        action: 'payment.obligation.approve',
        targetType: 'PaymentObligation',
        targetId: obligation.id,
      },
    });
    return obligation;
  }

  async scheduleRelease(campaignParticipantId: string, completedAt = new Date()) {
    const obligation = await this.prisma.paymentObligation.findUnique({
      where: { campaignParticipantId },
      include: { participant: { include: { creator: true } } },
    });
    if (!obligation || obligation.status !== 'APPROVED') return obligation;
    const availableAt = payoutReleaseAt(completedAt);
    const updated = await this.prisma.paymentObligation.update({
      where: { id: obligation.id },
      data: { availableAt },
    });
    await notify(this.prisma, {
      userId: obligation.participant.creator.userId,
      type: 'payment.release.scheduled',
      title: 'Payout release scheduled',
      body: `Your payout will be released after ${availableAt.toISOString()} unless a dispute is opened.`,
      href: '/app/earnings',
      dedupeKey: `payment-release:${obligation.id}:${availableAt.toISOString()}`,
    });
    return updated;
  }
}

function normalizeNgPhone(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length >= 13) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+234${digits.slice(1)}`;
  if (digits.length === 10) return `+234${digits}`;
  throw new BadRequestException('Enter a valid Nigerian phone number.');
}

function mockDvaAccountNumber(brandId: string) {
  const digits = brandId.replace(/\D/g, '').padEnd(9, '0').slice(0, 9);
  return `9${digits}`;
}
