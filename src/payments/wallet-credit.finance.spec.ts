import { testNotifications } from '../test-support/notifications';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createFundedBrand,
  createTestPrisma,
  describeWithDb,
  resetDatabase,
  walletBalance,
} from '../test-support/finance-db';
import { WalletService } from './wallet.service';

function rejectionReasons(results: PromiseSettledResult<unknown>[]) {
  return results
    .filter((row): row is PromiseRejectedResult => row.status === 'rejected')
    .map((row) => {
      const reason = row.reason as
        { code?: string; message?: string } | undefined;
      return `${reason?.code ?? ''} ${reason?.message ?? String(row.reason)}`.trim();
    });
}

describeWithDb('WalletService.creditFromPaystack (real database)', () => {
  let prisma: PrismaService;
  let wallets: WalletService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    wallets = new WalletService(prisma, new WorkspaceService(prisma), testNotifications(prisma));
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => resetDatabase(prisma));

  async function pendingTopUp(
    brandId: string,
    reference: string,
    amount: number,
  ) {
    await prisma.ledgerTransaction.create({
      data: {
        type: 'COLLECTION',
        amount,
        status: 'PENDING',
        provider: 'paystack',
        providerReference: reference,
        idempotencyKey: `fund_${reference}`,
        metadata: { brandId, purpose: 'wallet_topup' },
      },
    });
  }

  it('credits a pending card top-up exactly once when webhook and browser verify race', async () => {
    const { brand } = await createFundedBrand(prisma, 0);
    await pendingTopUp(brand.id, 'fund_race_1', 50_000);

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        wallets.creditFromPaystack({
          reference: 'fund_race_1',
          amountKobo: 5_000_000,
          brandId: brand.id,
        }),
      ),
    );

    // Same strictness as before (every call must succeed), but a failure now shows why.
    expect(rejectionReasons(results)).toEqual([]);
    expect(await walletBalance(prisma, brand.id)).toBe(50_000);
    const rows = await prisma.ledgerTransaction.findMany({
      where: { providerReference: 'fund_race_1' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('SUCCEEDED');
  });

  it('credits a transfer (no pending row) exactly once under concurrent webhook deliveries', async () => {
    const { brand } = await createFundedBrand(prisma, 1_000);

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        wallets.creditFromPaystack({
          reference: 'dva_transfer_1',
          amountKobo: 2_500_000,
          brandId: brand.id,
        }),
      ),
    );

    expect(rejectionReasons(results)).toEqual([]);
    expect(await walletBalance(prisma, brand.id)).toBe(26_000);
    expect(
      await prisma.ledgerTransaction.count({
        where: { providerReference: 'dva_transfer_1' },
      }),
    ).toBe(1);
  });

  it('is idempotent across sequential retries', async () => {
    const { brand } = await createFundedBrand(prisma, 0);
    await pendingTopUp(brand.id, 'fund_retry_1', 10_000);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await wallets.creditFromPaystack({
        reference: 'fund_retry_1',
        amountKobo: 1_000_000,
        brandId: brand.id,
      });
    }
    expect(await walletBalance(prisma, brand.id)).toBe(10_000);
  });

  it('refuses a charge whose amount does not match the pending top-up', async () => {
    const { brand } = await createFundedBrand(prisma, 0);
    await pendingTopUp(brand.id, 'fund_mismatch_1', 10_000);
    await expect(
      wallets.creditFromPaystack({
        reference: 'fund_mismatch_1',
        amountKobo: 9_000_000,
        brandId: brand.id,
      }),
    ).rejects.toThrow('does not match');
    expect(await walletBalance(prisma, brand.id)).toBe(0);
  });

  it('refuses a charge that names a different brand than the pending top-up', async () => {
    const first = await createFundedBrand(prisma, 0);
    const second = await createFundedBrand(prisma, 0);
    await pendingTopUp(first.brand.id, 'fund_brand_1', 10_000);
    await expect(
      wallets.creditFromPaystack({
        reference: 'fund_brand_1',
        amountKobo: 1_000_000,
        brandId: second.brand.id,
      }),
    ).rejects.toThrow('does not match');
    expect(await walletBalance(prisma, first.brand.id)).toBe(0);
    expect(await walletBalance(prisma, second.brand.id)).toBe(0);
  });
});
