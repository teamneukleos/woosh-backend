import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { asNumber, capacityRequired, splitFee } from '../common/fees';
import {
  assertProductionPaymentConfiguration,
  payoutReleaseAt,
} from '../common/payments-policy';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  assignDedicatedVirtualAccount,
  createDedicatedVirtualAccount,
  createPaystackCustomer,
  getPaystackCustomer,
  initializeTransaction,
  PaystackError,
  paystackConfigured,
  paystackCustomerNotFound,
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
    private readonly notifications: NotificationsService,
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

  private async ensurePaystackCustomer(input: {
    walletId: string;
    storedCustomerCode: string | null;
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    brandId: string;
    actorEmail: string;
  }) {
    const stored = input.storedCustomerCode?.startsWith('CUS_')
      ? input.storedCustomerCode
      : null;

    const fetchCustomer = async (emailOrCode: string) => {
      try {
        return await getPaystackCustomer(emailOrCode);
      } catch (error) {
        if (paystackCustomerNotFound(error)) return null;
        throw error;
      }
    };

    let customer = stored ? await fetchCustomer(stored) : null;
    if (!customer) customer = await fetchCustomer(input.email);
    if (!customer) {
      try {
        customer = await createPaystackCustomer({
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
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
          customer = await getPaystackCustomer(input.email);
        } else {
          throw error;
        }
      }
    }
    if (!customer) {
      throw new BadRequestException('Could not create a Paystack customer for this brand.');
    }

    await updatePaystackCustomer(customer.customer_code, {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    });

    if (customer.customer_code !== input.storedCustomerCode) {
      await this.prisma.brandWallet.update({
        where: { id: input.walletId },
        data: { paystackCustomerCode: customer.customer_code },
      });
    }
    return customer;
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
    const customer = await this.ensurePaystackCustomer({
      walletId: wallet.id,
      storedCustomerCode: wallet.paystackCustomerCode,
      email: customerEmail,
      firstName,
      lastName,
      phone,
      brandId: input.brandId,
      actorEmail: input.actorEmail,
    });
    const customerCode = customer.customer_code;

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
        customer: customer.id || customerCode,
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

  /**
   * Credits a confirmed Paystack collection exactly once. The webhook and the browser's
   * verify callback can arrive together (and Paystack retries webhooks), so the balance is
   * only incremented by the request that wins the PENDING→SUCCEEDED claim, or that inserts
   * the unique `fund_<reference>` ledger row. Every other caller is a no-op.
   */
  async creditFromPaystack(input: { reference: string; amountKobo: number; brandId: string }) {
    const amountMajor = input.amountKobo / 100;
    const wallet = await this.getOrCreate(input.brandId);
    let credited = false;
    try {
      credited = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.ledgerTransaction.findFirst({
          where: { providerReference: input.reference, type: 'COLLECTION' },
        });
        if (existing?.status === 'SUCCEEDED') return false;
        if (existing) {
          const metadata = existing.metadata as { brandId?: string } | null;
          if (
            Number(existing.amount) !== amountMajor ||
            existing.currency !== 'NGN' ||
            String(metadata?.brandId ?? '') !== input.brandId
          ) {
            throw new BadRequestException(
              'Paystack charge does not match the pending collection.',
            );
          }
          // Row lock: a concurrent claimer re-checks the WHERE after we commit and gets 0.
          const claimed = await tx.ledgerTransaction.updateMany({
            where: { id: existing.id, status: 'PENDING' },
            data: { status: 'SUCCEEDED', completedAt: new Date() },
          });
          if (claimed.count !== 1) return false;
        } else {
          // A concurrent insert of the same reference fails on the unique idempotency key.
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
        return true;
      });
    } catch (error) {
      const alreadyCredited =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!alreadyCredited) throw error;
    }
    // After commit, and only from the call that credited: webhook retries stay silent.
    if (credited) {
      await this.notifications.notifyBrand(input.brandId, {
        type: 'wallet.funded',
        title: 'Wallet funded',
        body: `${wallet.currency} ${amountMajor.toLocaleString()} was added to your Woosh wallet.`,
        href: '/app/payments',
        permission: 'payments.approve',
        dedupePrefix: `wallet-funded:${input.reference}`,
      });
    }
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

  /**
   * Promotes the creator's reserved payment to APPROVED as part of the caller's transaction.
   * Never creates a payment: approval only ever moves money that commitOnAccept already took
   * out of the brand wallet. Later deliverables for the same creator find it APPROVED (no-op).
   */
  async approveOnDeliverableApprove(
    tx: Prisma.TransactionClient,
    campaignParticipantId: string,
    actorUserId: string,
  ) {
    // Row lock first: approvals for the same creator then run one at a time, so the
    // "final deliverable" check in scheduleReleaseIfFinal sees every committed approval.
    const locked = await tx.paymentObligation.updateMany({
      where: { campaignParticipantId },
      data: { updatedAt: new Date() },
    });
    const obligation = locked.count
      ? await tx.paymentObligation.findUnique({ where: { campaignParticipantId } })
      : null;
    if (!obligation || !(await hasReservedFunds(tx, obligation))) {
      throw new BadRequestException(
        'Payment for this creator has not been reserved from the brand wallet, so this work cannot be approved. Contact Woosh support.',
      );
    }
    if (obligation.status === 'APPROVED') return obligation;
    if (obligation.status !== 'COMMITTED') {
      throw new BadRequestException(
        `This creator's payment is ${obligation.status.toLowerCase()}; resolve it before approving more work.`,
      );
    }
    const claimed = await tx.paymentObligation.updateMany({
      where: { id: obligation.id, status: 'COMMITTED' },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('Payment changed while approving; refresh and try again.');
    }
    await tx.auditEvent.create({
      data: {
        actorId: actorUserId,
        action: 'payment.obligation.approve',
        targetType: 'PaymentObligation',
        targetId: obligation.id,
      },
    });
    return { ...obligation, status: 'APPROVED' as const };
  }

  /**
   * Starts the 72-hour hold when the creator's final outstanding deliverable is approved.
   * Runs in the approval transaction after approveOnDeliverableApprove (which holds the
   * payment row lock). Only ever sets a release time once; never moves money.
   * Returns the release time if this call scheduled it, otherwise null.
   */
  async scheduleReleaseIfFinal(
    tx: Prisma.TransactionClient,
    campaignParticipantId: string,
    actorUserId: string,
    approvedAt = new Date(),
  ) {
    const outstanding = await tx.deliverable.count({
      where: {
        campaignParticipantId,
        state: { notIn: ['APPROVED', 'SCHEDULED', 'LIVE', 'COMPLETED'] },
      },
    });
    if (outstanding > 0) return null;
    const obligation = await tx.paymentObligation.findUnique({
      where: { campaignParticipantId },
    });
    if (!obligation) return null;
    const availableAt = payoutReleaseAt(approvedAt);
    const scheduled = await tx.paymentObligation.updateMany({
      where: { id: obligation.id, status: 'APPROVED', availableAt: null },
      data: { availableAt },
    });
    if (scheduled.count !== 1) return null;
    await tx.auditEvent.create({
      data: {
        actorId: actorUserId,
        action: 'payment.release.schedule',
        targetType: 'PaymentObligation',
        targetId: obligation.id,
        after: { availableAt: availableAt.toISOString(), trigger: 'final_approval' },
      },
    });
    return { obligationId: obligation.id, availableAt };
  }

  /** Tells the creator their payout is scheduled. Safe to call more than once. */
  async notifyReleaseScheduled(obligationId: string, availableAt: Date) {
    const obligation = await this.prisma.paymentObligation.findUnique({
      where: { id: obligationId },
      include: { participant: { include: { creator: true } } },
    });
    if (!obligation) return;
    await this.notifications.create({
      userId: obligation.participant.creator.userId,
      type: 'payment.release.scheduled',
      title: 'Payout release scheduled',
      body: `Your payout will be released after ${formatUtc(availableAt)} unless a dispute is opened.`,
      href: '/app/earnings',
      dedupeKey: `payment-release:${obligation.id}`,
    });
  }

  /**
   * Completion path (Mark complete). Only schedules a release that approval has not already
   * scheduled; it never restarts or extends an existing 72-hour hold.
   */
  async scheduleRelease(campaignParticipantId: string, completedAt = new Date()) {
    const obligation = await this.prisma.paymentObligation.findUnique({
      where: { campaignParticipantId },
    });
    if (!obligation || obligation.status !== 'APPROVED') return obligation;
    if (obligation.availableAt) return obligation;
    const availableAt = payoutReleaseAt(completedAt);
    const scheduled = await this.prisma.paymentObligation.updateMany({
      where: { id: obligation.id, status: 'APPROVED', availableAt: null },
      data: { availableAt },
    });
    if (scheduled.count === 1) await this.notifyReleaseScheduled(obligation.id, availableAt);
    return this.prisma.paymentObligation.findUnique({ where: { id: obligation.id } });
  }
}

/**
 * True only when commitOnAccept actually debited the brand wallet for this payment: the
 * SUCCEEDED `commit_<participant>` ledger row exists, belongs to it and covers the gross.
 */
export async function hasReservedFunds(
  db: Prisma.TransactionClient | PrismaService,
  obligation: { id: string; campaignParticipantId: string; grossAmount: Prisma.Decimal | number },
) {
  const reservation = await db.ledgerTransaction.findUnique({
    where: { idempotencyKey: `commit_${obligation.campaignParticipantId}` },
  });
  return Boolean(
    reservation &&
      reservation.status === 'SUCCEEDED' &&
      reservation.obligationId === obligation.id &&
      Number(reservation.amount) >= capacityRequired(Number(obligation.grossAmount)),
  );
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

/** "26 Nov 2026, 14:05 UTC" — readable in email and in-app copy. */
export function formatUtc(value: Date) {
  return `${value.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })} UTC`;
}
