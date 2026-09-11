import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { assertProductionPaymentConfiguration } from '../common/payments-policy';
import { PrismaService } from '../prisma/prisma.service';
import { encryptAccountNumber } from './payout-account-crypto';
import {
  createTransferRecipient,
  listPaystackBanks,
  paystackConfigured,
  resolvePaystackAccount,
} from './paystack.client';
import { presentPayoutAccount } from './present';

const DEV_BANKS = [
  { name: 'Access Bank', code: '044', active: true },
  { name: 'First Bank of Nigeria', code: '011', active: true },
  { name: 'Guaranty Trust Bank', code: '058', active: true },
  { name: 'United Bank for Africa', code: '033', active: true },
  { name: 'Zenith Bank', code: '057', active: true },
];

function requirePaymentConfig() {
  try {
    assertProductionPaymentConfiguration();
  } catch (error) {
    throw new ServiceUnavailableException(
      error instanceof Error ? error.message : 'Payments are not configured.',
    );
  }
}

@Injectable()
export class PayoutAccountService {
  constructor(private readonly prisma: PrismaService) {}

  async listBanks() {
    requirePaymentConfig();
    if (!paystackConfigured()) return DEV_BANKS;
    return (await listPaystackBanks()).filter((bank) => bank.active);
  }

  async getMine(creatorProfileId: string) {
    const account = await this.prisma.creatorPayoutAccount.findUnique({
      where: { creatorProfileId },
    });
    return presentPayoutAccount(account);
  }

  async verifyAndSave(input: {
    creatorProfileId: string;
    actorUserId: string;
    bankCode: string;
    accountNumber: string;
  }) {
    requirePaymentConfig();
    const bankCode = input.bankCode.trim();
    const accountNumber = input.accountNumber.replace(/\s/g, '');
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new BadRequestException('Enter a valid 10-digit NUBAN account number.');
    }
    const banks = await this.listBanks();
    const bank = banks.find((item) => item.code === bankCode);
    if (!bank) throw new BadRequestException('Select a supported bank.');

    const resolved = paystackConfigured()
      ? await resolvePaystackAccount({ accountNumber, bankCode })
      : { account_number: accountNumber, account_name: 'Verified development account' };
    const recipient = paystackConfigured()
      ? await createTransferRecipient({
          name: resolved.account_name,
          accountNumber,
          bankCode,
          currency: 'NGN',
        })
      : { recipient_code: `DEV_${input.creatorProfileId}` };

    const saved = await this.prisma.creatorPayoutAccount.upsert({
      where: { creatorProfileId: input.creatorProfileId },
      create: {
        creatorProfileId: input.creatorProfileId,
        bankCode,
        bankName: bank.name,
        accountName: resolved.account_name,
        encryptedAccountNumber: encryptAccountNumber(accountNumber),
        accountNumberLast4: accountNumber.slice(-4),
        recipientCode: recipient.recipient_code,
        verifiedAt: new Date(),
        verificationReference: `paystack:${recipient.recipient_code}`,
      },
      update: {
        bankCode,
        bankName: bank.name,
        accountName: resolved.account_name,
        accountNumber: null,
        encryptedAccountNumber: encryptAccountNumber(accountNumber),
        accountNumberLast4: accountNumber.slice(-4),
        recipientCode: recipient.recipient_code,
        verifiedAt: new Date(),
        verificationReference: `paystack:${recipient.recipient_code}`,
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorId: input.actorUserId,
        action: 'payout_account.verify',
        targetType: 'CreatorPayoutAccount',
        targetId: saved.id,
        after: { bankCode, last4: accountNumber.slice(-4) },
      },
    });
    return presentPayoutAccount(saved);
  }
}
