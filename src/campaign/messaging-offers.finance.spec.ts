// Real-database check of the DM agreement path: the thread exposes the offer linked to a
// counter-offer system message, the creator agrees through the existing agreeOffer(), and
// the brand can then accept at the agreed amount.
import { SelectionService } from '../marketplace/selection.service';
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
import { testNotifications } from '../test-support/notifications';
import { CampaignAccessService } from './access.service';
import { MessagingGateway } from './messaging.gateway';
import { MessagingService } from './messaging.service';

describeWithDb('Counter-offers in the application DM (real database)', () => {
  let prisma: PrismaService;
  let selection: SelectionService;
  let messaging: MessagingService;

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
    messaging = new MessagingService(
      prisma,
      new CampaignAccessService(prisma, workspace),
      { emitMessage: jest.fn() } as unknown as MessagingGateway,
      notifications,
    );
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(() => resetDatabase(prisma));

  async function brandCountered() {
    const { owner, brand } = await createFundedBrand(prisma, 100_000);
    const creator = await createCreator(prisma);
    const { application } = await createApplication(prisma, {
      brandId: brand.id,
      creatorProfileId: creator.profile.id,
      rate: 50_000,
    });
    const counter = await selection.counterOffer(
      owner.id,
      application.id,
      30_000,
    );
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { applicationId: application.id },
    });
    return { owner, brand, creator, application, counter, conversation };
  }

  it('returns the linked offer on the counter-offer system message, and null on other messages', async () => {
    const { owner, creator, counter, conversation } = await brandCountered();
    await messaging.send(
      creator.user.id,
      conversation.id,
      'Alright, no problem',
    );

    const thread = await messaging.get(creator.user.id, conversation.id);

    const counterMessage = thread.messages.find((m) => m.offer);
    expect(counterMessage).toMatchObject({
      isSystem: true,
      body: 'Counter-offer: 30000 NGN',
      offer: {
        id: counter.id,
        status: 'COUNTERED',
        createdById: owner.id,
        createdBySide: 'brand',
        amount: 30_000,
        currency: 'NGN',
      },
    });
    const reply = thread.messages.find((m) => m.body === 'Alright, no problem');
    expect(reply?.offer).toBeNull();
    // A plain chat reply is not an agreement.
    expect(
      (await prisma.offer.findUniqueOrThrow({ where: { id: counter.id } }))
        .status,
    ).toBe('COUNTERED');
  });

  it('lets the creator agree from the DM, after which the brand accepts at the counter amount', async () => {
    const { owner, brand, creator, application, conversation } =
      await brandCountered();

    // The creator's DM button posts the offer id carried on the message.
    const before = await messaging.get(creator.user.id, conversation.id);
    const offerId = before.messages.find((m) => m.offer)!.offer!.id;
    await selection.agreeOffer(creator.user.id, offerId);

    const after = await messaging.get(creator.user.id, conversation.id);
    const linked = after.messages.filter((m) => m.offer);
    expect(linked.map((m) => [m.body, m.offer!.status])).toEqual([
      ['Counter-offer: 30000 NGN', 'AGREED'],
      ['Offer agreed at 30000 NGN', 'AGREED'],
    ]);
    expect(
      await prisma.notification.count({
        where: { userId: owner.id, type: 'offer.agreed' },
      }),
    ).toBe(1);

    const accepted = await selection.accept(owner.id, application.id);
    expect(accepted.agreedRate).toBe(30_000);
    expect(await walletBalance(prisma, brand.id)).toBe(70_000);
  });
});
