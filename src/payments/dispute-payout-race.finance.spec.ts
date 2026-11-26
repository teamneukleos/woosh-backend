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
const record = (reference: string, status: string) => ({
  reference,
  status,
  amount: 4_000_000,
  currency: 'NGN',
});

describeWithDb(
  'Disputes can never race a payout into paying twice (real database)',
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
      jest.restoreAllMocks();
      transfer.mockReset();
      verify.mockReset();
      transfer.mockImplementation(async (input) => ({
        transfer_code: 'TRF',
        status: 'pending',
        reference: input.reference,
      }));
    });

    /** Reserved, approved, hold over, first payout attempt definitely rejected → FAILED. */
    async function failedPayment() {
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
      transfer.mockRejectedValueOnce(
        new PaystackError('Your balance is not enough', 400),
      );
      verify.mockRejectedValueOnce(
        new PaystackError('Transfer not found', 404),
      );
      await expect(
        payouts.initiatePayout({
          obligationId: obligation.id,
          actorUserId: owner.id,
        }),
      ).rejects.toThrow();
      const admin = await prisma.user.create({
        data: {
          email: `admin-${obligation.id}@test.woosh`,
          status: 'ACTIVE',
          emailVerified: new Date(),
          isPlatformAdmin: true,
        },
      });
      const [attempt] = await prisma.ledgerTransaction.findMany({
        where: { obligationId: obligation.id, type: 'PAYOUT' },
      });
      return {
        owner,
        admin,
        brand,
        obligationId: obligation.id,
        reference: attempt.providerReference!,
      };
    }

    const obligation = (id: string) =>
      prisma.paymentObligation.findUniqueOrThrow({ where: { id } });
    const openDelayDispute = (actorUserId: string, obligationId: string) =>
      disputes.open({
        actorUserId,
        obligationId,
        category: 'PAYOUT_DELAY',
        subject: 'Payout has not arrived',
        description: 'The creator has not received the payout yet.',
      });

    it('a dispute that read the payment just before a payout claimed it cannot overwrite PROCESSING', async () => {
      const { owner, obligationId } = await failedPayment();
      expect((await obligation(obligationId)).status).toBe('FAILED');
      // The dispute request read the payment while it was FAILED...
      const stale = await payouts.requireObligationAccess(
        obligationId,
        owner.id,
      );
      // ...then the release job claimed it and sent the transfer.
      await payouts.initiatePayout({ obligationId, automated: true });
      expect((await obligation(obligationId)).status).toBe('PROCESSING');
      jest
        .spyOn(payouts, 'requireObligationAccess')
        .mockResolvedValueOnce(stale);

      await expect(openDelayDispute(owner.id, obligationId)).rejects.toThrow(
        /changed|progress/i,
      );

      expect((await obligation(obligationId)).status).toBe('PROCESSING');
      expect(await prisma.dispute.count()).toBe(0);
    });

    it('refuses to refund the brand while a payout attempt is still pending', async () => {
      const { owner, admin, brand, obligationId, reference } =
        await failedPayment();
      const dispute = await openDelayDispute(owner.id, obligationId);
      // A transfer for this payment is still in flight (state left by an earlier race).
      await prisma.ledgerTransaction.updateMany({
        where: { providerReference: reference },
        data: { status: 'PENDING' },
      });

      await expect(
        disputes.resolve({
          disputeId: dispute.id,
          actorUserId: admin.id,
          resolutionType: 'REFUND_BRAND',
          resolution: 'Refund the reserved funds to the brand.',
        }),
      ).rejects.toThrow(/pay twice|in progress/i);

      expect(await walletBalance(prisma, brand.id)).toBe(60_000);
      expect((await obligation(obligationId)).status).toBe('DISPUTED');
      expect(
        await prisma.ledgerTransaction.count({ where: { type: 'REFUND' } }),
      ).toBe(0);
    });

    it('refuses to refund the brand when Paystack says an attempt was actually paid', async () => {
      const { owner, admin, brand, obligationId, reference } =
        await failedPayment();
      const dispute = await openDelayDispute(owner.id, obligationId);
      verify.mockResolvedValue(record(reference, 'success'));

      await expect(
        disputes.resolve({
          disputeId: dispute.id,
          actorUserId: admin.id,
          resolutionType: 'REFUND_BRAND',
          resolution: 'Refund the reserved funds to the brand.',
        }),
      ).rejects.toThrow(/pay twice|paid/i);

      expect(await walletBalance(prisma, brand.id)).toBe(60_000);
      expect(
        await prisma.ledgerTransaction.count({ where: { type: 'REFUND' } }),
      ).toBe(0);
    });

    it('refuses to refund the brand when Paystack cannot confirm the attempt failed', async () => {
      const { owner, admin, brand, obligationId } = await failedPayment();
      const dispute = await openDelayDispute(owner.id, obligationId);
      verify.mockRejectedValue(new TypeError('fetch failed'));

      await expect(
        disputes.resolve({
          disputeId: dispute.id,
          actorUserId: admin.id,
          resolutionType: 'REFUND_BRAND',
          resolution: 'Refund the reserved funds to the brand.',
        }),
      ).rejects.toThrow();

      expect(await walletBalance(prisma, brand.id)).toBe(60_000);
    });

    it('refunds the brand exactly once when Paystack confirms no transfer can land', async () => {
      const { owner, admin, brand, obligationId } = await failedPayment();
      const dispute = await openDelayDispute(owner.id, obligationId);
      verify.mockRejectedValue(new PaystackError('Transfer not found', 404));
      const input = {
        disputeId: dispute.id,
        actorUserId: admin.id,
        resolutionType: 'REFUND_BRAND' as const,
        resolution: 'Refund the reserved funds to the brand.',
      };

      const results = await Promise.allSettled([
        disputes.resolve(input),
        disputes.resolve(input),
      ]);

      expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(
        1,
      );
      expect((await obligation(obligationId)).status).toBe('REVERSED');
      expect(await walletBalance(prisma, brand.id)).toBe(100_000);
      expect(
        await prisma.ledgerTransaction.count({ where: { type: 'REFUND' } }),
      ).toBe(1);
      // And nothing can pay it afterwards.
      await payouts.processAutomaticReleases(
        new Date(Date.now() + 60 * 60 * 1000),
      );
      expect(transfer).toHaveBeenCalledTimes(1);
    });

    it('a payment frozen by a dispute is never picked up by the release job', async () => {
      const { owner, obligationId } = await failedPayment();
      await openDelayDispute(owner.id, obligationId);
      verify.mockRejectedValue(new PaystackError('Transfer not found', 404));

      const result = await payouts.processAutomaticReleases(
        new Date(Date.now() + 60 * 60 * 1000),
      );

      expect(result.queued).toBe(0);
      expect(transfer).toHaveBeenCalledTimes(1);
      expect((await obligation(obligationId)).status).toBe('DISPUTED');
    });
  },
);
