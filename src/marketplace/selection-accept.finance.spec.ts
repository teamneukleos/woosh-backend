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
    selection = new SelectionService(
      prisma,
      workspace,
      new WalletService(prisma, workspace),
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
});
