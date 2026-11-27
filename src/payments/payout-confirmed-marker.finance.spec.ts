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
const record = (reference: string, status: string) => ({
  reference,
  status,
  amount: 4_000_000,
  currency: 'NGN',
});
const LATER = () => new Date(Date.now() + 2 * 60 * 60 * 1000);

describeWithDb(
  'A Paystack-confirmed failure on an already-FAILED payout is recorded (real database)',
  () => {
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
      transfer.mockImplementation(async (input) => ({
        transfer_code: 'TRF',
        status: 'pending',
        reference: input.reference,
      }));
    });

    /**
     * First attempt definitely rejected and Paystack had no record of it at the time,
     * so it is FAILED without a Paystack-confirmed marker (eligible for same-reference retry).
     */
    async function failedWithoutMarker() {
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
        new PaystackError('Recipient bank unavailable', 400),
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
      const [attempt] = await prisma.ledgerTransaction.findMany({
        where: { obligationId: obligation.id, type: 'PAYOUT' },
      });
      expect(attempt.status).toBe('FAILED');
      expect(
        (attempt.metadata as { paystackOutcome?: string }).paystackOutcome,
      ).toBeUndefined();
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
        obligationId: obligation.id,
        reference: attempt.providerReference!,
      };
    }

    const attemptMeta = async (reference: string) =>
      (
        await prisma.ledgerTransaction.findFirstOrThrow({
          where: { providerReference: reference },
        })
      ).metadata as { paystackOutcome?: string };

    it('a later transfer.failed webhook marks it, stops automatic retries and allows admin recovery', async () => {
      const { owner, admin, obligationId, reference } =
        await failedWithoutMarker();

      await payouts.completeFromWebhook({
        reference,
        success: false,
        failureReason: 'Account dormant',
        amountKobo: 4_000_000,
        currency: 'NGN',
      });

      expect((await attemptMeta(reference)).paystackOutcome).toBe('failed');
      const result = await payouts.processAutomaticReleases(LATER());
      expect(result.manualRecovery).toBe(1);
      await expect(
        payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
      ).rejects.toThrow(/manual recovery/i);
      expect(transfer).toHaveBeenCalledTimes(1);

      verify.mockResolvedValue(record(reference, 'failed'));
      await expect(
        payouts.authorizeRecoveryAttempt({
          obligationId,
          adminUserId: admin.id,
          reason: 'Creator updated their bank account',
        }),
      ).resolves.toMatchObject({ failedReference: reference });
    });

    it('Paystack verification reporting failed on retry marks it, so recovery is not stuck', async () => {
      const { owner, admin, obligationId, reference } =
        await failedWithoutMarker();
      verify.mockResolvedValue(record(reference, 'failed'));

      await expect(
        payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
      ).rejects.toThrow(/manual recovery/i);

      expect((await attemptMeta(reference)).paystackOutcome).toBe('failed');
      expect(transfer).toHaveBeenCalledTimes(1);
      await expect(
        payouts.authorizeRecoveryAttempt({
          obligationId,
          adminUserId: admin.id,
          reason: 'Creator updated their bank account',
        }),
      ).resolves.toMatchObject({ failedReference: reference });
    });

    it('duplicate failure webhooks only mark it once and change nothing else', async () => {
      const { obligationId, reference } = await failedWithoutMarker();
      const event = {
        reference,
        success: false,
        failureReason: 'Account dormant',
        amountKobo: 4_000_000,
        currency: 'NGN',
      };

      await Promise.all([
        payouts.completeFromWebhook(event),
        payouts.completeFromWebhook(event),
        payouts.completeFromWebhook(event),
      ]);

      expect((await attemptMeta(reference)).paystackOutcome).toBe('failed');
      const payment = await prisma.paymentObligation.findUniqueOrThrow({
        where: { id: obligationId },
      });
      expect(payment.status).toBe('FAILED');
      expect(
        await prisma.ledgerTransaction.count({
          where: { obligationId, type: 'PAYOUT' },
        }),
      ).toBe(1);
    });

    it('without a confirmed failure, the same-reference retry still works as before', async () => {
      const { owner, obligationId, reference } = await failedWithoutMarker();
      verify.mockRejectedValue(new PaystackError('Transfer not found', 404));

      await payouts.initiatePayout({ obligationId, actorUserId: owner.id });

      expect(transfer).toHaveBeenCalledTimes(2);
      expect(
        new Set(transfer.mock.calls.map(([input]) => input.reference)),
      ).toEqual(new Set([reference]));
    });
  },
);
