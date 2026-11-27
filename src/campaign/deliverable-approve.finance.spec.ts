import { testNotifications } from '../test-support/notifications';
import { SelectionService } from '../marketplace/selection.service';
import { WorkspaceService } from '../organisation/workspace.service';
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

describeWithDb('DeliverablesService.approve (real database)', () => {
  let prisma: PrismaService;
  let selection: SelectionService;
  let deliverables: DeliverablesService;

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
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => resetDatabase(prisma));

  async function submitted(deliverableId: string, creatorUserId: string) {
    await prisma.deliverable.update({
      where: { id: deliverableId },
      data: { state: 'DRAFT_SUBMITTED' },
    });
    await prisma.submission.create({
      data: {
        deliverableId,
        version: 1,
        submittedById: creatorUserId,
        draftUrl: 'https://example.com/draft.mp4',
      },
    });
  }

  /** A real accepted campaign: funds reserved through SelectionService.accept. */
  async function fundedCampaign(deliverableCount = 1) {
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
    for (const row of rows) await submitted(row.id, creator.user.id);
    return {
      owner,
      brand,
      creator,
      campaignId: accepted.campaignId,
      deliverables: rows,
    };
  }

  /** A campaign that exists without any reserved funds (legacy/seeded data). */
  async function unfundedCampaign(withObligation: boolean) {
    const { owner, brand } = await createFundedBrand(prisma, 100_000);
    const creator = await createCreator(prisma);
    const { brief } = await createApplication(prisma, {
      brandId: brand.id,
      creatorProfileId: creator.profile.id,
      rate: 40_000,
    });
    const campaign = await prisma.campaign.create({
      data: { briefId: brief.id, brandId: brand.id, title: 'Legacy' },
    });
    const participant = await prisma.campaignParticipant.create({
      data: {
        campaignId: campaign.id,
        creatorProfileId: creator.profile.id,
        agreedRate: 40_000,
        termsAcceptedAt: new Date(),
      },
    });
    if (withObligation) {
      await prisma.paymentObligation.create({
        data: {
          campaignParticipantId: participant.id,
          grossAmount: 40_000,
          netAmount: 40_000,
          status: 'COMMITTED',
        },
      });
    }
    const deliverable = await prisma.deliverable.create({
      data: {
        campaignId: campaign.id,
        campaignParticipantId: participant.id,
        title: 'Legacy deliverable',
      },
    });
    await submitted(deliverable.id, creator.user.id);
    return { owner, brand, participant, deliverable };
  }

  it('approves funded work and promotes the reserved payment without moving money', async () => {
    const { owner, brand, deliverables: rows } = await fundedCampaign();

    await deliverables.approve(owner.id, rows[0].id);

    const deliverable = await prisma.deliverable.findUniqueOrThrow({
      where: { id: rows[0].id },
    });
    expect(deliverable.state).toBe('APPROVED');
    const obligation = await prisma.paymentObligation.findFirstOrThrow();
    expect(obligation.status).toBe('APPROVED');
    expect(obligation.approvedAt).not.toBeNull();
    expect(await walletBalance(prisma, brand.id)).toBe(60_000);
  });

  it('refuses to approve when no payment was ever reserved, and creates no payment', async () => {
    const { owner, deliverable } = await unfundedCampaign(false);

    await expect(
      deliverables.approve(owner.id, deliverable.id),
    ).rejects.toThrow(/not been reserved/i);

    expect(await prisma.paymentObligation.count()).toBe(0);
    const after = await prisma.deliverable.findUniqueOrThrow({
      where: { id: deliverable.id },
    });
    expect(after.state).toBe('DRAFT_SUBMITTED');
  });

  it('refuses a payment record that has no matching wallet reservation', async () => {
    const { owner, deliverable } = await unfundedCampaign(true);

    await expect(
      deliverables.approve(owner.id, deliverable.id),
    ).rejects.toThrow(/not been reserved/i);

    const obligation = await prisma.paymentObligation.findFirstOrThrow();
    expect(obligation.status).toBe('COMMITTED');
    const after = await prisma.deliverable.findUniqueOrThrow({
      where: { id: deliverable.id },
    });
    expect(after.state).toBe('DRAFT_SUBMITTED');
  });

  it('approves each deliverable of a multi-deliverable campaign once', async () => {
    const { owner, deliverables: rows } = await fundedCampaign(2);

    await deliverables.approve(owner.id, rows[0].id);
    await deliverables.approve(owner.id, rows[1].id);

    expect(
      await prisma.deliverable.count({ where: { state: 'APPROVED' } }),
    ).toBe(2);
    expect((await prisma.paymentObligation.findFirstOrThrow()).status).toBe(
      'APPROVED',
    );
  });

  it('lets exactly one of several concurrent approvals win', async () => {
    const { owner, deliverables: rows } = await fundedCampaign();

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        deliverables.approve(owner.id, rows[0].id),
      ),
    );

    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect((await prisma.paymentObligation.findFirstOrThrow()).status).toBe(
      'APPROVED',
    );
    expect(
      await prisma.auditEvent.count({
        where: { action: 'payment.obligation.approve' },
      }),
    ).toBe(1);
  });

  it('does not let the creator or another brand approve', async () => {
    const { creator, deliverables: rows } = await fundedCampaign();
    const outsider = await createFundedBrand(prisma, 0);

    await expect(
      deliverables.approve(creator.user.id, rows[0].id),
    ).rejects.toThrow();
    await expect(
      deliverables.approve(outsider.owner.id, rows[0].id),
    ).rejects.toThrow();

    expect((await prisma.paymentObligation.findFirstOrThrow()).status).toBe(
      'COMMITTED',
    );
  });
});
