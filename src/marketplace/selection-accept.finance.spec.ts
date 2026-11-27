import { testNotifications } from '../test-support/notifications';
import { WorkspaceService } from '../organisation/workspace.service';
import { WalletService } from '../payments/wallet.service';
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
import { SelectionService } from './selection.service';

describeWithDb('SelectionService.accept (real database)', () => {
  let prisma: PrismaService;
  let selection: SelectionService;

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
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => resetDatabase(prisma));

  it('reserves funds and opens one campaign on accept', async () => {
    const { owner, brand } = await createFundedBrand(prisma, 100_000);
    const creator = await createCreator(prisma);
    const { application } = await createApplication(prisma, {
      brandId: brand.id,
      creatorProfileId: creator.profile.id,
      rate: 40_000,
    });

    const result = await selection.accept(owner.id, application.id);

    expect(result.agreedRate).toBe(40_000);
    expect(await walletBalance(prisma, brand.id)).toBe(60_000);
    const obligation = await prisma.paymentObligation.findFirstOrThrow({
      where: { participant: { campaignId: result.campaignId } },
    });
    expect(obligation.status).toBe('COMMITTED');
    expect(Number(obligation.grossAmount)).toBe(40_000);
  });

  it('debits once and creates one campaign when the same application is accepted concurrently', async () => {
    const { owner, brand } = await createFundedBrand(prisma, 100_000);
    const creator = await createCreator(prisma);
    const { application } = await createApplication(prisma, {
      brandId: brand.id,
      creatorProfileId: creator.profile.id,
      rate: 40_000,
    });

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        selection.accept(owner.id, application.id),
      ),
    );

    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.campaign.count()).toBe(1);
    expect(await prisma.paymentObligation.count()).toBe(1);
    expect(await walletBalance(prisma, brand.id)).toBe(60_000);
  });

  it('never accepts more creators than the brief allows, even concurrently', async () => {
    const { owner, brand } = await createFundedBrand(prisma, 500_000);
    const brief = await prisma.brief.create({
      data: {
        brandId: brand.id,
        title: 'One slot',
        description: 'Only one creator',
        status: 'OPEN',
        rateAmount: 10_000,
        maxCreators: 1,
      },
    });
    const applications = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const creator = await createCreator(prisma);
        return prisma.application.create({
          data: { briefId: brief.id, creatorProfileId: creator.profile.id },
        });
      }),
    );

    const results = await Promise.allSettled(
      applications.map((row) => selection.accept(owner.id, row.id)),
    );

    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.application.count({ where: { status: 'ACCEPTED' } }),
    ).toBe(1);
    expect(await prisma.campaign.count()).toBe(1);
    expect(await walletBalance(prisma, brand.id)).toBe(490_000);
  });

  it('rolls back the campaign and keeps the application open when funds are insufficient', async () => {
    const { owner, brand } = await createFundedBrand(prisma, 5_000);
    const creator = await createCreator(prisma);
    const { application } = await createApplication(prisma, {
      brandId: brand.id,
      creatorProfileId: creator.profile.id,
      rate: 40_000,
    });

    await expect(selection.accept(owner.id, application.id)).rejects.toThrow(
      'Insufficient brand funds',
    );

    expect(await prisma.campaign.count()).toBe(0);
    expect(await prisma.paymentObligation.count()).toBe(0);
    expect(await walletBalance(prisma, brand.id)).toBe(5_000);
    const after = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    expect(after.status).toBe('APPLIED');
  });

  it('refuses a brand user from a different brand', async () => {
    const { brand } = await createFundedBrand(prisma, 100_000);
    const outsider = await createFundedBrand(prisma, 100_000);
    const creator = await createCreator(prisma);
    const { application } = await createApplication(prisma, {
      brandId: brand.id,
      creatorProfileId: creator.profile.id,
      rate: 40_000,
    });

    await expect(
      selection.accept(outsider.owner.id, application.id),
    ).rejects.toThrow();
    expect(await walletBalance(prisma, brand.id)).toBe(100_000);
    expect(await walletBalance(prisma, outsider.brand.id)).toBe(100_000);
  });

  describe('after a brand counter-offer', () => {
    /** Creator proposed 40,000; the brand countered 30,000 (the staging sequence). */
    async function countered(balance: number) {
      const { owner, brand } = await createFundedBrand(prisma, balance);
      const creator = await createCreator(prisma);
      const { application } = await createApplication(prisma, {
        brandId: brand.id,
        creatorProfileId: creator.profile.id,
        rate: 50_000,
      });
      await prisma.application.update({
        where: { id: application.id },
        data: { proposedRate: 40_000 },
      });
      await prisma.offer.create({
        data: {
          applicationId: application.id,
          amount: 40_000,
          status: 'OPEN',
          createdById: creator.user.id,
        },
      });
      const counter = await selection.counterOffer(
        owner.id,
        application.id,
        30_000,
      );
      return { owner, brand, creator, application, counter };
    }

    it('accepts at the agreed counter amount once the creator agrees, and reserves that amount', async () => {
      const { owner, brand, creator, application, counter } =
        await countered(100_000);
      await selection.agreeOffer(creator.user.id, counter.id);

      const result = await selection.accept(owner.id, application.id);

      expect(result.agreedRate).toBe(30_000);
      expect(await walletBalance(prisma, brand.id)).toBe(70_000);
      const participant = await prisma.campaignParticipant.findFirstOrThrow({
        where: { campaignId: result.campaignId },
        include: { obligations: true },
      });
      expect(Number(participant.agreedRate)).toBe(30_000);
      expect(Number(participant.obligations[0]?.grossAmount)).toBe(30_000);
      expect(
        (await prisma.application.findUniqueOrThrow({
          where: { id: application.id },
        })).status,
      ).toBe('ACCEPTED');
    });

    it('refuses to accept while the counter-offer is still waiting for the creator, and reserves nothing', async () => {
      const { owner, brand, application } = await countered(100_000);

      await expect(selection.accept(owner.id, application.id)).rejects.toThrow(
        'The creator must agree to the active offer first.',
      );

      expect(await prisma.campaign.count()).toBe(0);
      expect(await walletBalance(prisma, brand.id)).toBe(100_000);
      expect(
        (await prisma.application.findUniqueOrThrow({
          where: { id: application.id },
        })).status,
      ).toBe('APPLIED');
    });

    it('does not let the brand mark its own counter-offer as agreed', async () => {
      const { owner, counter } = await countered(100_000);

      await expect(selection.agreeOffer(owner.id, counter.id)).rejects.toThrow(
        'The other party cannot accept this offer now.',
      );
    });

    it('reports insufficient funds against the agreed counter amount and rolls back', async () => {
      const { owner, brand, creator, application, counter } =
        await countered(20_000);
      await selection.agreeOffer(creator.user.id, counter.id);

      await expect(selection.accept(owner.id, application.id)).rejects.toThrow(
        'Insufficient brand funds. Need ₦30,000',
      );

      expect(await prisma.campaign.count()).toBe(0);
      expect(await prisma.paymentObligation.count()).toBe(0);
      expect(await walletBalance(prisma, brand.id)).toBe(20_000);
      expect(
        (await prisma.application.findUniqueOrThrow({
          where: { id: application.id },
        })).status,
      ).toBe('APPLIED');
    });
  });
});
