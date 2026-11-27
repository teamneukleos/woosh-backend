/* eslint-disable @typescript-eslint/require-await -- async mock implementations model Paystack calls */
jest.mock('./paystack.client', () => ({
  ...jest.requireActual<object>('./paystack.client'),
  paystackConfigured: jest.fn(() => true),
  initiateTransfer: jest.fn(),
  verifyTransfer: jest.fn(),
}));

import { testNotifications } from '../test-support/notifications';
import { SelectionService } from '../marketplace/selection.service';
import { WorkspaceService } from '../organisation/workspace.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  createApplication,
  createCreator,
  createFundedBrand,
  createTestPrisma,
  describeWithDb,
  resetDatabase,
} from '../test-support/finance-db';
import {
  initiateTransfer,
  PaystackError,
  verifyTransfer,
} from './paystack.client';
import { PayoutService } from './payout.service';
import { WalletService } from './wallet.service';

const transfer = initiateTransfer as jest.MockedFunction<
  typeof initiateTransfer
>;
const verify = verifyTransfer as jest.MockedFunction<typeof verifyTransfer>;

const transferRecord = (reference: string, status: string) => ({
  reference,
  status,
  amount: 4_000_000,
  currency: 'NGN',
});

describeWithDb('PayoutService (real database, mocked Paystack)', () => {
  let prisma: PrismaService;
  let selection: SelectionService;
  let payouts: PayoutService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    const workspace = new WorkspaceService(prisma);
    const notifications = testNotifications(prisma);
    selection = new SelectionService(
      prisma,
      workspace,
      new WalletService(prisma, workspace, notifications),
      notifications,
    );
    payouts = new PayoutService(prisma, workspace, notifications);
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDatabase(prisma);
    transfer.mockReset();
    verify.mockReset();
  });

  /** A real reserved payment (via accept), approved and past its 72h window. */
  async function releasablePayment() {
    const { owner, brand } = await createFundedBrand(prisma, 100_000);
    const creator = await createCreator(prisma);
    const { application } = await createApplication(prisma, {
      brandId: brand.id,
      creatorProfileId: creator.profile.id,
      rate: 40_000,
    });
    await selection.accept(owner.id, application.id);
    await prisma.creatorPayoutAccount.create({
      data: {
        creatorProfileId: creator.profile.id,
        bankCode: '058',
        recipientCode: 'RCP_test',
        verifiedAt: new Date(),
      },
    });
    const obligation = await prisma.paymentObligation.findFirstOrThrow();
    await prisma.paymentObligation.update({
      where: { id: obligation.id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        availableAt: new Date(Date.now() - 60_000),
      },
    });
    return { owner, obligationId: obligation.id };
  }

  const payoutRows = (obligationId: string) =>
    prisma.ledgerTransaction.findMany({
      where: { obligationId, type: 'PAYOUT' },
      orderBy: { createdAt: 'asc' },
    });
  const status = async (id: string) =>
    (await prisma.paymentObligation.findUniqueOrThrow({ where: { id } }))
      .status;

  /** Pretend the transfer attempt was submitted long enough ago to be reconciled. */
  async function ageProcessing(obligationId: string) {
    await prisma.paymentObligation.update({
      where: { id: obligationId },
      data: { processingAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
  }

  it('records the payout reference before calling Paystack, then settles on the webhook', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockImplementation(async (input) => {
      const rows = await payoutRows(obligationId);
      expect(rows).toHaveLength(1);
      expect(rows[0].providerReference).toBe(input.reference);
      expect(rows[0].status).toBe('PENDING');
      return {
        transfer_code: 'TRF_1',
        status: 'pending',
        reference: input.reference,
      };
    });

    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(await status(obligationId)).toBe('PROCESSING');
    const [row] = await payoutRows(obligationId);
    await payouts.completeFromWebhook({
      reference: row.providerReference!,
      success: true,
      amountKobo: 4_000_000,
      currency: 'NGN',
    });
    expect(await status(obligationId)).toBe('PAID');
    expect((await payoutRows(obligationId))[0].status).toBe('SUCCEEDED');
    expect(
      await prisma.financialDocument.count({ where: { obligationId } }),
    ).toBe(1);
  });

  it('never sends a second transfer after an ambiguous Paystack error', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockRejectedValue(new TypeError('fetch failed: socket hang up'));

    const first = await payouts.initiatePayout({
      obligationId,
      actorUserId: owner.id,
    });
    expect(first.status).toBe('processing');
    expect(await status(obligationId)).toBe('PROCESSING');

    // Brand clicks again, and the release job runs: neither may start another transfer.
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    await payouts.processAutomaticReleases(
      new Date(Date.now() + 60 * 60 * 1000),
    );
    expect(transfer).toHaveBeenCalledTimes(1);

    // Paystack did receive it. Reconciliation settles the same reference.
    const [row] = await payoutRows(obligationId);
    verify.mockResolvedValue(transferRecord(row.providerReference!, 'success'));
    await ageProcessing(obligationId);
    await payouts.reconcileProcessing();

    expect(await status(obligationId)).toBe('PAID');
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(await payoutRows(obligationId)).toHaveLength(1);
  });

  it('recovers a crash after Paystack accepted the transfer without paying twice', async () => {
    const { owner, obligationId } = await releasablePayment();
    // Paystack accepts, then the process dies before anything else is written.
    transfer.mockImplementation(async (input) => {
      verify.mockResolvedValue(transferRecord(input.reference, 'success'));
      throw new Error('process crashed');
    });
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    await ageProcessing(obligationId);

    await payouts.processAutomaticReleases(
      new Date(Date.now() + 60 * 60 * 1000),
    );
    await payouts.reconcileProcessing();

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(await status(obligationId)).toBe('PAID');
  });

  it('retries a definitely rejected payout with the same stable reference', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockRejectedValueOnce(
      new PaystackError('Insufficient balance', 400),
    );
    verify.mockRejectedValue(new PaystackError('Transfer not found', 404));

    await expect(
      payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
    ).rejects.toThrow('Insufficient balance');
    expect(await status(obligationId)).toBe('FAILED');

    transfer.mockImplementation(async (input) => ({
      transfer_code: 'TRF_2',
      status: 'pending',
      reference: input.reference,
    }));
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });

    const rows = await payoutRows(obligationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING');
    expect(await status(obligationId)).toBe('PROCESSING');
    expect(transfer).toHaveBeenCalledTimes(2);
    const references = transfer.mock.calls.map(([input]) => input.reference);
    expect(new Set(references)).toEqual(new Set([rows[0].providerReference]));
  });

  it('never opens a new reference after an ambiguous timeout, even once reconciled as pending', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockRejectedValue(
      new TypeError('The operation was aborted due to timeout'),
    );
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    const [row] = await payoutRows(obligationId);

    verify.mockResolvedValue(transferRecord(row.providerReference!, 'pending'));
    await ageProcessing(obligationId);
    await payouts.reconcileProcessing();
    verify.mockRejectedValue(new TypeError('fetch failed'));
    await payouts.reconcileProcessing();
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    await payouts.processAutomaticReleases(
      new Date(Date.now() + 60 * 60 * 1000),
    );

    expect(await status(obligationId)).toBe('PROCESSING');
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(await payoutRows(obligationId)).toHaveLength(1);
  });

  it('never automatically opens a second reference after Paystack confirms a failure', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockImplementation(async (input) => ({
      transfer_code: 'TRF_F',
      status: 'pending',
      reference: input.reference,
    }));
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    const [first] = await payoutRows(obligationId);
    await payouts.completeFromWebhook({
      reference: first.providerReference!,
      success: false,
      failureReason: 'Account dormant',
      amountKobo: 4_000_000,
      currency: 'NGN',
    });
    expect(await status(obligationId)).toBe('FAILED');

    verify.mockResolvedValue(
      transferRecord(first.providerReference!, 'failed'),
    );
    await expect(
      payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
    ).rejects.toThrow(/manual recovery/i);

    const rows = await payoutRows(obligationId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('FAILED');
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(await status(obligationId)).toBe('FAILED');
  });

  it('a confirmed successful payout can never be sent again', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockImplementation(async (input) => ({
      transfer_code: 'TRF_P',
      status: 'pending',
      reference: input.reference,
    }));
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    const [row] = await payoutRows(obligationId);
    await payouts.completeFromWebhook({
      reference: row.providerReference!,
      success: true,
      amountKobo: 4_000_000,
      currency: 'NGN',
    });

    verify.mockResolvedValue(transferRecord(row.providerReference!, 'success'));
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    await payouts.processAutomaticReleases(
      new Date(Date.now() + 60 * 60 * 1000),
    );
    await ageProcessing(obligationId);
    await payouts.reconcileProcessing();
    await payouts.completeFromWebhook({
      reference: row.providerReference!,
      success: true,
      amountKobo: 4_000_000,
      currency: 'NGN',
    });

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(await status(obligationId)).toBe('PAID');
    expect(await payoutRows(obligationId)).toHaveLength(1);
  });

  it('settles instead of re-sending when a "failed" payout actually went through', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockRejectedValueOnce(
      new PaystackError('Recipient bank unavailable', 400),
    );
    verify.mockRejectedValueOnce(new PaystackError('Transfer not found', 404));
    await expect(
      payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
    ).rejects.toThrow();
    expect(await status(obligationId)).toBe('FAILED');

    // Later Paystack reports the first attempt as successful after all.
    const [row] = await payoutRows(obligationId);
    verify.mockResolvedValue(transferRecord(row.providerReference!, 'success'));
    await payouts.processAutomaticReleases(
      new Date(Date.now() + 60 * 60 * 1000),
    );

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(await status(obligationId)).toBe('PAID');
  });

  it('refuses to pay out a payment that was never reserved from the brand wallet', async () => {
    const { owner, obligationId } = await releasablePayment();
    await prisma.ledgerTransaction.deleteMany({
      where: { idempotencyKey: { startsWith: 'commit_' } },
    });

    await expect(
      payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
    ).rejects.toThrow(/not reserved/i);
    const result = await payouts.processAutomaticReleases(
      new Date(Date.now() + 60 * 60 * 1000),
    );

    expect(result.queued).toBe(0);
    expect(transfer).not.toHaveBeenCalled();
    expect(await status(obligationId)).toBe('APPROVED');
  });

  it('the release job never pays an unfunded FAILED payment', async () => {
    const { owner, obligationId } = await releasablePayment();
    await prisma.ledgerTransaction.deleteMany({
      where: { idempotencyKey: { startsWith: 'commit_' } },
    });
    await prisma.paymentObligation.update({
      where: { id: obligationId },
      data: { status: 'FAILED', failedAt: new Date() },
    });

    const result = await payouts.processAutomaticReleases(
      new Date(Date.now() + 60 * 60 * 1000),
    );
    await expect(
      payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
    ).rejects.toThrow(/not reserved/i);

    expect(result.queued).toBe(0);
    expect(transfer).not.toHaveBeenCalled();
    expect(await status(obligationId)).toBe('FAILED');
  });

  it('refuses to release before the 72-hour hold has passed', async () => {
    const { owner, obligationId } = await releasablePayment();
    await prisma.paymentObligation.update({
      where: { id: obligationId },
      data: { availableAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await expect(
      payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
    ).rejects.toThrow(/window/i);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('never releases a payment with an open dispute, manually or by the job', async () => {
    const { owner, obligationId } = await releasablePayment();
    const obligation = await prisma.paymentObligation.findUniqueOrThrow({
      where: { id: obligationId },
      include: { participant: true },
    });
    await prisma.dispute.create({
      data: {
        raisedById: owner.id,
        obligationId,
        campaignId: obligation.participant.campaignId,
        category: 'CONTENT_APPROVAL',
        subject: 'Not as agreed',
        description: 'Content does not match the brief',
        status: 'OPEN',
      },
    });

    await expect(
      payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
    ).rejects.toThrow(/dispute/i);
    const result = await payouts.processAutomaticReleases(
      new Date(Date.now() + 60 * 60 * 1000),
    );

    expect(result.queued).toBe(0);
    expect(transfer).not.toHaveBeenCalled();
    expect(await status(obligationId)).toBe('APPROVED');
  });

  it('keeps the wallet and ledger consistent from top-up to paid payout', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockImplementation(async (input) => ({
      transfer_code: 'TRF_L',
      status: 'pending',
      reference: input.reference,
    }));
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    const [row] = await payoutRows(obligationId);
    await payouts.completeFromWebhook({
      reference: row.providerReference!,
      success: true,
      amountKobo: 4_000_000,
      currency: 'NGN',
    });

    const wallet = await prisma.brandWallet.findFirstOrThrow();
    const ledger = await prisma.ledgerTransaction.findMany({
      where: { obligationId },
      orderBy: { createdAt: 'asc' },
    });
    const obligation = await prisma.paymentObligation.findUniqueOrThrow({
      where: { id: obligationId },
    });
    // Funded 100,000; 40,000 reserved at accept; payout sends exactly the reserved net once.
    expect(Number(wallet.balance)).toBe(60_000);
    expect(
      ledger.map((entry) => [entry.type, entry.status, Number(entry.amount)]),
    ).toEqual([
      ['ADJUSTMENT', 'SUCCEEDED', 40_000],
      ['PAYOUT', 'SUCCEEDED', Number(obligation.netAmount)],
    ]);
    expect(obligation.status).toBe('PAID');
    expect(transfer).toHaveBeenCalledTimes(1);
  });

  it('sends one transfer when payout is triggered concurrently', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockImplementation(async (input) => ({
      transfer_code: 'TRF_C',
      status: 'pending',
      reference: input.reference,
    }));

    await Promise.allSettled([
      payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
      payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
      payouts.processAutomaticReleases(),
      payouts.initiatePayout({ obligationId, automated: true }),
    ]);

    expect(transfer).toHaveBeenCalledTimes(1);
    expect(await payoutRows(obligationId)).toHaveLength(1);
  });

  it('handles duplicate concurrent success webhooks once', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockImplementation(async (input) => ({
      transfer_code: 'TRF_W',
      status: 'pending',
      reference: input.reference,
    }));
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    const [row] = await payoutRows(obligationId);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        payouts.completeFromWebhook({
          reference: row.providerReference!,
          success: true,
          amountKobo: 4_000_000,
          currency: 'NGN',
        }),
      ),
    );

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await status(obligationId)).toBe('PAID');
    expect(
      await prisma.financialDocument.count({ where: { obligationId } }),
    ).toBe(1);
  });

  it('a reversed transfer refunds the brand exactly once', async () => {
    const { owner, obligationId } = await releasablePayment();
    transfer.mockImplementation(async (input) => ({
      transfer_code: 'TRF_R',
      status: 'pending',
      reference: input.reference,
    }));
    await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
    const [row] = await payoutRows(obligationId);
    const event = {
      reference: row.providerReference!,
      success: false,
      reversed: true,
      failureReason: 'Reversed by bank',
      amountKobo: 4_000_000,
      currency: 'NGN',
    };

    await payouts.completeFromWebhook(event);
    await payouts.completeFromWebhook(event);

    expect(await status(obligationId)).toBe('REVERSED');
    const wallet = await prisma.brandWallet.findFirstOrThrow();
    expect(Number(wallet.balance)).toBe(100_000);
  });
});
