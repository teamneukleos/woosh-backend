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
  'Payout references and manual recovery (real database, mocked Paystack)',
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
      const admin = await prisma.user.create({
        data: {
          email: `admin-${obligation.id}@test.woosh`,
          status: 'ACTIVE',
          emailVerified: new Date(),
          isPlatformAdmin: true,
        },
      });
      return { owner, admin, obligationId: obligation.id };
    }

    const rows = (obligationId: string) =>
      prisma.ledgerTransaction.findMany({
        where: { obligationId, type: 'PAYOUT' },
        orderBy: { createdAt: 'asc' },
      });
    const status = async (id: string) =>
      (await prisma.paymentObligation.findUniqueOrThrow({ where: { id } }))
        .status;
    const sentReferences = () =>
      transfer.mock.calls.map(([input]) => input.reference);

    /** First attempt sent, then Paystack reports it failed via webhook. */
    async function confirmedFailure() {
      const ctx = await releasablePayment();
      await payouts.initiatePayout({
        obligationId: ctx.obligationId,
        actorUserId: ctx.owner.id,
      });
      const [first] = await rows(ctx.obligationId);
      await payouts.completeFromWebhook({
        reference: first.providerReference!,
        success: false,
        failureReason: 'Account dormant',
        amountKobo: 4_000_000,
        currency: 'NGN',
      });
      verify.mockResolvedValue(record(first.providerReference!, 'failed'));
      return { ...ctx, firstReference: first.providerReference! };
    }

    describe('confirmed failures are never retried automatically', () => {
      it('webhook-confirmed failure: the release job sends nothing and opens no new reference', async () => {
        const { obligationId } = await confirmedFailure();

        const result = await payouts.processAutomaticReleases(LATER());
        await payouts.processAutomaticReleases(LATER());

        expect(transfer).toHaveBeenCalledTimes(1);
        expect(await rows(obligationId)).toHaveLength(1);
        expect(result.manualRecovery).toBe(1);
        expect(result.queued).toBe(0);
        expect(await status(obligationId)).toBe('FAILED');
      });

      it('failure confirmed by reconciliation: no automatic second reference either', async () => {
        const { owner, obligationId } = await releasablePayment();
        transfer.mockRejectedValueOnce(new TypeError('socket hang up'));
        await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
        const [first] = await rows(obligationId);
        verify.mockResolvedValue(record(first.providerReference!, 'failed'));
        await prisma.paymentObligation.update({
          where: { id: obligationId },
          data: { processingAt: new Date(Date.now() - 60 * 60 * 1000) },
        });

        await payouts.reconcileProcessing();
        expect(await status(obligationId)).toBe('FAILED');
        await expect(
          payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
        ).rejects.toThrow(/manual recovery/i);
        await payouts.processAutomaticReleases(LATER());

        expect(transfer).toHaveBeenCalledTimes(1);
        expect(await rows(obligationId)).toHaveLength(1);
      });
    });

    describe('ambiguous outcomes keep the original reference', () => {
      it('reuses the one reference through repeated unknown and not-found checks', async () => {
        const { owner, obligationId } = await releasablePayment();
        transfer.mockRejectedValueOnce(
          new TypeError('The operation was aborted due to timeout'),
        );
        await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
        const [first] = await rows(obligationId);
        const age = () =>
          prisma.paymentObligation.update({
            where: { id: obligationId },
            data: { processingAt: new Date(Date.now() - 60 * 60 * 1000) },
          });

        verify.mockRejectedValue(new TypeError('fetch failed'));
        await age();
        await payouts.reconcileProcessing();
        verify.mockRejectedValue(new PaystackError('Transfer not found', 404));
        await age();
        await payouts.reconcileProcessing();
        await payouts.processAutomaticReleases(LATER());

        expect(await rows(obligationId)).toHaveLength(1);
        expect(new Set(sentReferences())).toEqual(
          new Set([first.providerReference]),
        );
        expect(transfer).toHaveBeenCalledTimes(2);
      });
    });

    describe('manual recovery after a confirmed failure', () => {
      it('requires a platform admin and a reason', async () => {
        const { owner, obligationId } = await confirmedFailure();

        await expect(
          payouts.authorizeRecoveryAttempt({
            obligationId,
            adminUserId: owner.id,
            reason: 'Creator updated bank details',
          }),
        ).rejects.toThrow(/admin/i);
        const admin = await prisma.user.findFirstOrThrow({
          where: { isPlatformAdmin: true },
        });
        await expect(
          payouts.authorizeRecoveryAttempt({
            obligationId,
            adminUserId: admin.id,
            reason: 'ok',
          }),
        ).rejects.toThrow(/reason/i);
        expect(await rows(obligationId)).toHaveLength(1);
      });

      it('is refused when there is no Paystack-confirmed failure to recover from', async () => {
        const { admin, obligationId } = await releasablePayment();

        await expect(
          payouts.authorizeRecoveryAttempt({
            obligationId,
            adminUserId: admin.id,
            reason: 'Trying to force a payout',
          }),
        ).rejects.toThrow(/confirmed/i);
      });

      it('settles instead of authorising when Paystack now reports the transfer paid', async () => {
        const { admin, obligationId, firstReference } =
          await confirmedFailure();
        verify.mockResolvedValue(record(firstReference, 'success'));

        await expect(
          payouts.authorizeRecoveryAttempt({
            obligationId,
            adminUserId: admin.id,
            reason: 'Creator says funds never arrived',
          }),
        ).rejects.toThrow(/paid/i);

        expect(await status(obligationId)).toBe('PAID');
        expect(transfer).toHaveBeenCalledTimes(1);
      });

      it('an authorised recovery sends exactly one new reference, even when retried concurrently', async () => {
        const { owner, admin, obligationId, firstReference } =
          await confirmedFailure();

        await payouts.authorizeRecoveryAttempt({
          obligationId,
          adminUserId: admin.id,
          reason: 'Creator corrected their bank account',
        });
        // Paystack: the first transfer failed; anything just sent is still pending.
        verify.mockImplementation(async (reference) =>
          record(
            reference,
            reference === firstReference ? 'failed' : 'pending',
          ),
        );
        await Promise.allSettled([
          payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
          payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
          payouts.processAutomaticReleases(LATER()),
          payouts.initiatePayout({ obligationId, automated: true }),
        ]);

        const attempts = await rows(obligationId);
        expect(attempts).toHaveLength(2);
        expect(attempts[1].providerReference).not.toBe(firstReference);
        expect(transfer).toHaveBeenCalledTimes(2);
        expect(await status(obligationId)).toBe('PROCESSING');
        expect(
          await prisma.auditEvent.count({
            where: { action: 'payment.payout.recovery_authorized' },
          }),
        ).toBe(1);
      });

      it('one authorisation covers one attempt; a second failure needs a new decision', async () => {
        const { owner, admin, obligationId } = await confirmedFailure();
        await payouts.authorizeRecoveryAttempt({
          obligationId,
          adminUserId: admin.id,
          reason: 'Creator corrected their bank account',
        });
        await payouts.initiatePayout({ obligationId, actorUserId: owner.id });
        const second = (await rows(obligationId))[1];
        await payouts.completeFromWebhook({
          reference: second.providerReference!,
          success: false,
          failureReason: 'Account dormant again',
          amountKobo: 4_000_000,
          currency: 'NGN',
        });
        verify.mockImplementation(async (reference) =>
          record(reference, 'failed'),
        );

        await expect(
          payouts.initiatePayout({ obligationId, actorUserId: owner.id }),
        ).rejects.toThrow(/manual recovery/i);
        await payouts.processAutomaticReleases(LATER());

        expect(await rows(obligationId)).toHaveLength(2);
        expect(transfer).toHaveBeenCalledTimes(2);
      });

      it('cannot be authorised twice for the same failed attempt', async () => {
        const { admin, obligationId } = await confirmedFailure();
        const input = {
          obligationId,
          adminUserId: admin.id,
          reason: 'Creator corrected their bank account',
        };

        const results = await Promise.allSettled([
          payouts.authorizeRecoveryAttempt(input),
          payouts.authorizeRecoveryAttempt(input),
        ]);

        expect(
          results.filter((row) => row.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(
          await prisma.auditEvent.count({
            where: { action: 'payment.payout.recovery_authorized' },
          }),
        ).toBe(1);
      });
    });
  },
);
