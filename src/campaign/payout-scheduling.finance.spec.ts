/* eslint-disable @typescript-eslint/require-await -- async mock implementations model Paystack calls */
jest.mock('../payments/paystack.client', () => ({
  ...jest.requireActual<object>('../payments/paystack.client'),
  paystackConfigured: jest.fn(() => true),
  initiateTransfer: jest.fn(),
  verifyTransfer: jest.fn(),
}));

import { testNotifications } from '../test-support/notifications';
import { SelectionService } from '../marketplace/selection.service';
import { WorkspaceService } from '../organisation/workspace.service';
import { DisputesService } from '../payments/disputes.service';
import { initiateTransfer } from '../payments/paystack.client';
import { PayoutService } from '../payments/payout.service';
import { WalletService } from '../payments/wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import {
  createApplication,
  createCreator,
  createFundedBrand,
  createTestPrisma,
  describeWithDb,
  resetDatabase,
  walletBalance,
} from '../test-support/finance-db';
import { CampaignAccessService } from './access.service';
import { DeliverablesService } from './deliverables.service';

const transfer = initiateTransfer as jest.MockedFunction<
  typeof initiateTransfer
>;
const HOLD_MS = 72 * 60 * 60 * 1000;

describeWithDb('Approval schedules the payout release (real database)', () => {
  let prisma: PrismaService;
  let selection: SelectionService;
  let deliverables: DeliverablesService;
  let payouts: PayoutService;
  let disputes: DisputesService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
    const workspace = new WorkspaceService(prisma);
    const notifications = testNotifications(prisma);
    const wallets = new WalletService(prisma, workspace, notifications);
    selection = new SelectionService(prisma, workspace, wallets, notifications);
    deliverables = new DeliverablesService(
      prisma,
      new CampaignAccessService(prisma, workspace),
      workspace,
      wallets,
      {} as StorageService,
      notifications,
    );
    payouts = new PayoutService(prisma, workspace, notifications);
    disputes = new DisputesService(prisma, workspace, payouts, notifications);
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDatabase(prisma);
    transfer.mockReset();
    transfer.mockImplementation(async (input) => ({
      transfer_code: 'TRF_S',
      status: 'pending',
      reference: input.reference,
    }));
  });

  /** A real accepted campaign (funds reserved at accept) with submitted deliverables. */
  async function campaignWithSubmittedWork(deliverableCount: number) {
    const { owner, brand } = await createFundedBrand(prisma, 100_000);
    const creator = await createCreator(prisma);
    const { brief, application } = await createApplication(prisma, {
      brandId: brand.id,
      creatorProfileId: creator.profile.id,
      rate: 40_000,
    });
    await prisma.brief.update({
      where: { id: brief.id },
      data: {
        deliverables: Array.from({ length: deliverableCount }, (_, i) => ({
          title: `Deliverable ${i + 1}`,
        })),
      },
    });
    const accepted = await selection.accept(owner.id, application.id);
    await prisma.campaignParticipant.updateMany({
      where: { campaignId: accepted.campaignId },
      data: { termsAcceptedAt: new Date() },
    });
    const rows = await prisma.deliverable.findMany({
      where: { campaignId: accepted.campaignId },
      orderBy: { title: 'asc' },
    });
    for (const row of rows) {
      await prisma.deliverable.update({
        where: { id: row.id },
        data: { state: 'DRAFT_SUBMITTED' },
      });
      await prisma.submission.create({
        data: {
          deliverableId: row.id,
          version: 1,
          submittedById: creator.user.id,
          draftUrl: 'https://example.com/draft',
        },
      });
    }
    await prisma.creatorPayoutAccount.create({
      data: {
        creatorProfileId: creator.profile.id,
        bankCode: '058',
        recipientCode: 'RCP_test',
        verifiedAt: new Date(),
      },
    });
    return { owner, brand, creator, campaignId: accepted.campaignId, rows };
  }

  const obligation = () => prisma.paymentObligation.findFirstOrThrow();
  const ledgerRows = () =>
    prisma.ledgerTransaction.findMany({ orderBy: { createdAt: 'asc' } });

  it('approving the only deliverable starts the 72-hour hold without moving money', async () => {
    const { owner, brand, rows } = await campaignWithSubmittedWork(1);
    const before = Date.now();

    await deliverables.approve(owner.id, rows[0].id);

    const payment = await obligation();
    expect(payment.status).toBe('APPROVED');
    expect(payment.availableAt).not.toBeNull();
    const releaseAt = payment.availableAt!.getTime();
    expect(releaseAt).toBeGreaterThanOrEqual(before + HOLD_MS);
    expect(releaseAt).toBeLessThanOrEqual(Date.now() + HOLD_MS);
    expect(await walletBalance(prisma, brand.id)).toBe(60_000);
    expect((await ledgerRows()).map((row) => row.type)).toEqual(['ADJUSTMENT']);
  });

  it('only the final outstanding deliverable starts the hold', async () => {
    const { owner, rows } = await campaignWithSubmittedWork(2);

    await deliverables.approve(owner.id, rows[0].id);
    expect((await obligation()).availableAt).toBeNull();

    await deliverables.approve(owner.id, rows[1].id);
    expect((await obligation()).availableAt).not.toBeNull();
  });

  it('schedules exactly once when the final deliverables are approved at the same time', async () => {
    const { owner, rows } = await campaignWithSubmittedWork(2);

    const results = await Promise.allSettled(
      rows.map((row) => deliverables.approve(owner.id, row.id)),
    );

    expect(results.every((row) => row.status === 'fulfilled')).toBe(true);
    expect(
      await prisma.deliverable.count({ where: { state: 'APPROVED' } }),
    ).toBe(2);
    expect((await obligation()).availableAt).not.toBeNull();
    expect(
      await prisma.auditEvent.count({
        where: { action: 'payment.release.schedule' },
      }),
    ).toBe(1);
  });

  it('notifies the creator once that the payout is scheduled', async () => {
    const { owner, creator, rows } = await campaignWithSubmittedWork(1);

    await deliverables.approve(owner.id, rows[0].id);

    const notes = await prisma.notification.findMany({
      where: { userId: creator.user.id, type: 'payment.release.scheduled' },
    });
    expect(notes).toHaveLength(1);
  });

  it('mark live and mark complete never restart or extend a scheduled hold', async () => {
    const { owner, creator, rows } = await campaignWithSubmittedWork(1);
    await deliverables.approve(owner.id, rows[0].id);
    const scheduled = (await obligation()).availableAt!.getTime();

    await deliverables.setLive(
      creator.user.id,
      rows[0].id,
      'https://instagram.com/p/live',
    );
    await deliverables.complete(owner.id, rows[0].id);

    expect((await obligation()).availableAt!.getTime()).toBe(scheduled);
    const participant = await prisma.campaignParticipant.findFirstOrThrow();
    expect(participant.status).toBe('COMPLETED');
  });

  it('does not mark the campaign or participation completed when payout is scheduled', async () => {
    const { owner, campaignId, rows } = await campaignWithSubmittedWork(1);

    await deliverables.approve(owner.id, rows[0].id);

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    const participant = await prisma.campaignParticipant.findFirstOrThrow();
    expect(campaign.status).toBe('ACTIVE');
    expect(participant.status).toBe('ACTIVE');
  });

  it('a dispute raised during the hold freezes the payout', async () => {
    const { owner, rows } = await campaignWithSubmittedWork(1);
    await deliverables.approve(owner.id, rows[0].id);
    const payment = await obligation();

    await disputes.open({
      actorUserId: owner.id,
      obligationId: payment.id,
      category: 'CONTENT_APPROVAL',
      subject: 'Wrong product shown',
      description: 'The content shows the wrong product variant.',
    });
    const result = await payouts.processAutomaticReleases(
      new Date(Date.now() + HOLD_MS + 60_000),
    );

    expect((await obligation()).status).toBe('DISPUTED');
    expect(result.queued).toBe(0);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('the release job pays once after the hold, using the original reservation', async () => {
    const { owner, brand, rows } = await campaignWithSubmittedWork(1);
    await deliverables.approve(owner.id, rows[0].id);

    // Before the hold expires nothing is sent.
    await payouts.processAutomaticReleases(new Date());
    expect(transfer).not.toHaveBeenCalled();

    await prisma.paymentObligation.updateMany({
      data: { availableAt: new Date(Date.now() - 60_000) },
    });
    await payouts.processAutomaticReleases();
    await payouts.processAutomaticReleases();
    expect(transfer).toHaveBeenCalledTimes(1);

    const payout = (await ledgerRows()).find((row) => row.type === 'PAYOUT')!;
    await payouts.completeFromWebhook({
      reference: payout.providerReference!,
      success: true,
      amountKobo: 4_000_000,
      currency: 'NGN',
    });

    expect((await obligation()).status).toBe('PAID');
    expect(await walletBalance(prisma, brand.id)).toBe(60_000);
    expect((await ledgerRows()).map((row) => [row.type, row.status])).toEqual([
      ['ADJUSTMENT', 'SUCCEEDED'],
      ['PAYOUT', 'SUCCEEDED'],
    ]);
  });

  it('creator earnings report each payment in exactly one stage with its deliverables', async () => {
    const { owner, creator, rows } = await campaignWithSubmittedWork(1);

    let [entry] = await payouts.listCreatorEarnings(creator.profile.id);
    expect(entry.stage).toBe('reserved');
    expect(entry.deliverables.map((row) => row.title)).toEqual([
      'Deliverable 1',
    ]);
    expect(entry.campaign?.brand.name).toBe('Test Brand');

    await deliverables.approve(owner.id, rows[0].id);
    [entry] = await payouts.listCreatorEarnings(creator.profile.id);
    expect(entry.stage).toBe('pending');
    expect(entry.releaseAt).toEqual((await obligation()).availableAt);
  });
});
