/* eslint-disable @typescript-eslint/require-await -- async mock implementations model Paystack calls */
jest.mock('./paystack.client', () => ({
  ...jest.requireActual<object>('./paystack.client'),
  paystackConfigured: jest.fn(() => true),
  initiateTransfer: jest.fn(),
  verifyTransfer: jest.fn(),
}));

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
  walletBalance,
} from '../test-support/finance-db';
import { DisputesService } from './disputes.service';
import { initiateTransfer, verifyTransfer } from './paystack.client';
import { PayoutService } from './payout.service';
import { WalletService } from './wallet.service';

const transfer = initiateTransfer as jest.MockedFunction<
  typeof initiateTransfer
>;
const verify = verifyTransfer as jest.MockedFunction<typeof verifyTransfer>;
const LATER = () => new Date(Date.now() + 2 * 60 * 60 * 1000);

describeWithDb(
  'Reversal after a payout was PAID (real database, mocked Paystack)',
  () => {
    let prisma: PrismaService;
    let selection: SelectionService;
    let payouts: PayoutService;
    let disputes: DisputesService;

    beforeAll(async () => {
      prisma = createTestPrisma();
      await prisma.$connect();
      const workspace = new WorkspaceService(prisma);
      selection = new SelectionService(
        prisma,
        workspace,
        new WalletService(prisma, workspace),
      );
      payouts = new PayoutService(prisma, workspace);
      disputes = new DisputesService(prisma, workspace, payouts);
    });
    afterAll(() => prisma.$disconnect());
    beforeEach(async () => {
      await resetDatabase(prisma);
      transfer.mockReset();
      verify.mockReset();
      transfer.mockImplementation(async (input) => ({
        transfer_code: 'TRF',
        status: 'pending',
        reference: input.reference,
      }));
    });

    /** A real reserved payment, paid out once and confirmed PAID by Paystack. */
    async function paidPayment() {
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
      await payouts.initiatePayout({
        obligationId: obligation.id,
        actorUserId: owner.id,
      });
      const [attempt] = await prisma.ledgerTransaction.findMany({
        where: { obligationId: obligation.id, type: 'PAYOUT' },
      });
      await payouts.completeFromWebhook({
        reference: attempt.providerReference!,
        success: true,
        amountKobo: 4_000_000,
        currency: 'NGN',
      });
      const admin = await prisma.user.create({
        data: {
          email: `admin-${obligation.id}@test.woosh`,
          status: 'ACTIVE',
          emailVerified: new Date(),
          isPlatformAdmin: true,
        },
      });
      return {
        owner,
        admin,
        brand,
        creator,
        obligationId: obligation.id,
        reference: attempt.providerReference!,
      };
    }

    const reverse = (reference: string, amountKobo = 4_000_000) =>
      payouts.completeFromWebhook({
        reference,
        success: false,
        reversed: true,
        failureReason: 'Beneficiary bank returned the funds',
        amountKobo,
        currency: 'NGN',
      });
    const obligation = (id: string) =>
      prisma.paymentObligation.findUniqueOrThrow({ where: { id } });
    const payoutRows = (obligationId: string) =>
      prisma.ledgerTransaction.findMany({
        where: { obligationId, type: 'PAYOUT' },
        orderBy: { createdAt: 'asc' },
      });

    it('records the reversal: no longer paid, payout marked reversed, no money moved', async () => {
      const { brand, creator, obligationId, reference } = await paidPayment();
      expect((await obligation(obligationId)).status).toBe('PAID');

      await reverse(reference);

      const payment = await obligation(obligationId);
      expect(payment.status).toBe('FAILED');
      expect(payment.paidAt).toBeNull();
      expect(payment.reversedAt).not.toBeNull();
      expect(payment.failureReason).toMatch(/reversed/i);
      const [row] = await payoutRows(obligationId);
      expect(row.status).toBe('REVERSED');
      expect(
        (row.metadata as { paystackOutcome?: string }).paystackOutcome,
      ).toBe('reversed');
      // Neither the brand nor the creator is credited or debited automatically.
      expect(await walletBalance(prisma, brand.id)).toBe(60_000);
      expect(
        await prisma.ledgerTransaction.count({ where: { type: 'REFUND' } }),
      ).toBe(0);
      expect(transfer).toHaveBeenCalledTimes(1);
      expect(
        await prisma.auditEvent.count({
          where: { action: 'payment.payout.reversed_after_paid' },
        }),
      ).toBe(1);
      expect(
        await prisma.notification.count({
          where: { userId: creator.user.id, type: 'payment.reversed' },
        }),
      ).toBe(1);
    });

    it('duplicate and concurrent reversal webhooks change it exactly once', async () => {
      const { brand, obligationId, reference } = await paidPayment();

      const results = await Promise.allSettled([
        reverse(reference),
        reverse(reference),
        reverse(reference),
        reverse(reference),
      ]);
      await reverse(reference);

      expect(results.every((row) => row.status === 'fulfilled')).toBe(true);
      expect((await obligation(obligationId)).status).toBe('FAILED');
      expect(
        await prisma.auditEvent.count({
          where: { action: 'payment.payout.reversed_after_paid' },
        }),
      ).toBe(1);
      expect(await walletBalance(prisma, brand.id)).toBe(60_000);
      expect(
        await prisma.ledgerTransaction.count({ where: { type: 'REFUND' } }),
      ).toBe(0);
    });

    it('is never resent automatically, by the release job or a manual trigger', async () => {
      const { owner, obligationId, reference } = await paidPayment();
      await reverse(reference);

      const result = await payouts.processAutomaticReleases(LATER());
      await expect(
        payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
      ).rejects.toThrow(/manual recovery/i);

      expect(result.manualRecovery).toBe(1);
      expect(result.queued).toBe(0);
      expect(transfer).toHaveBeenCalledTimes(1);
      expect(await payoutRows(obligationId)).toHaveLength(1);
    });

    it('creator earnings show it as needing attention, never as paid', async () => {
      const { creator, reference } = await paidPayment();
      await reverse(reference);

      const [entry] = await payouts.listCreatorEarnings(creator.profile.id);

      expect(entry.status).toBe('FAILED');
      expect(entry.stage).toBe('attention');
    });

    it('an admin can authorise exactly one new attempt once Paystack confirms the reversal', async () => {
      const { owner, admin, obligationId, reference } = await paidPayment();
      await reverse(reference);
      verify.mockImplementation(async (ref) => ({
        reference: ref,
        status: ref === reference ? 'reversed' : 'pending',
        amount: 4_000_000,
        currency: 'NGN',
      }));

      await payouts.authorizeRecoveryAttempt({
        obligationId,
        adminUserId: admin.id,
        reason: 'Creator replaced the closed bank account',
      });
      await Promise.allSettled([
        payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
        payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
        payouts.processAutomaticReleases(LATER()),
      ]);

      const rows = await payoutRows(obligationId);
      expect(rows.map((row) => row.status)).toEqual(['REVERSED', 'PENDING']);
      expect(rows[1].providerReference).not.toBe(reference);
      expect(transfer).toHaveBeenCalledTimes(2);
    });

    it('alternatively an admin dispute resolution refunds the brand exactly once', async () => {
      const { owner, admin, brand, obligationId, reference } =
        await paidPayment();
      await reverse(reference);
      // The refund guard re-checks Paystack: the transfer is confirmed reversed.
      verify.mockResolvedValue({
        reference,
        status: 'reversed',
        amount: 4_000_000,
        currency: 'NGN',
      });

      const dispute = await disputes.open({
        actorUserId: owner.id,
        obligationId,
        category: 'PAYOUT_DELAY',
        subject: 'Payout reversed by the bank',
        description:
          'The creator was not paid; we want the reserved funds back.',
      });
      await disputes.resolve({
        disputeId: dispute.id,
        actorUserId: admin.id,
        resolutionType: 'REFUND_BRAND',
        resolution: 'Reversed payout refunded to the brand wallet.',
      });
      await reverse(reference);

      expect((await obligation(obligationId)).status).toBe('REVERSED');
      expect(await walletBalance(prisma, brand.id)).toBe(100_000);
      expect(
        await prisma.ledgerTransaction.count({ where: { type: 'REFUND' } }),
      ).toBe(1);
      await expect(
        payouts.authorizeRecoveryAttempt({
          obligationId,
          adminUserId: admin.id,
          reason: 'Trying to pay after the refund',
        }),
      ).rejects.toThrow();
      expect(transfer).toHaveBeenCalledTimes(1);
    });

    it('rejects a reversal whose amount does not match and changes nothing', async () => {
      const { obligationId, reference } = await paidPayment();

      await expect(reverse(reference, 3_000_000)).rejects.toThrow(/mismatch/i);

      expect((await obligation(obligationId)).status).toBe('PAID');
      expect((await payoutRows(obligationId))[0].status).toBe('SUCCEEDED');
    });
  },
);
