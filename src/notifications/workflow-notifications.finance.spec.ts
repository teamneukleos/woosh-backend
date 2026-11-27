// Real-database checks that product workflows record notifications through the central
// NotificationsService (in-app + email policy), not by writing rows directly.
import { CampaignAccessService } from '../campaign/access.service';
import { DeliverablesService } from '../campaign/deliverables.service';
import { MessagingGateway } from '../campaign/messaging.gateway';
import { MessagingService } from '../campaign/messaging.service';
import { SelectionService } from '../marketplace/selection.service';
import { WorkspaceService } from '../organisation/workspace.service';
import { WalletService } from '../payments/wallet.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  createApplication,
  createCreator,
  createFundedBrand,
  createTestPrisma,
  describeWithDb,
  resetDatabase,
  walletBalance,
} from '../test-support/finance-db';
import {
  RecordingMail,
  testNotifications,
} from '../test-support/notifications';

describeWithDb('Workflow notifications (real database)', () => {
  let prisma: PrismaService;
  let mail: RecordingMail;
  let selection: SelectionService;
  let wallets: WalletService;
  let deliverables: DeliverablesService;
  let messaging: MessagingService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
  });
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    await resetDatabase(prisma);
    mail = new RecordingMail('https://app.woosh.test');
    const workspace = new WorkspaceService(prisma);
    const notifications = testNotifications(prisma, mail);
    const access = new CampaignAccessService(prisma, workspace);
    wallets = new WalletService(prisma, workspace, notifications);
    selection = new SelectionService(prisma, workspace, wallets, notifications);
    deliverables = new DeliverablesService(
      prisma,
      access,
      workspace,
      wallets,
      {} as StorageService,
      notifications,
    );
    messaging = new MessagingService(
      prisma,
      access,
      { emitMessage: jest.fn() } as unknown as MessagingGateway,
      notifications,
    );
  });

  const sentTo = (email: string) => mail.sent.filter((row) => row.to === email);

  async function acceptedCampaign() {
    const brand = await createFundedBrand(prisma, 100_000);
    const creator = await createCreator(prisma);
    const { brief, application } = await createApplication(prisma, {
      brandId: brand.brand.id,
      creatorProfileId: creator.profile.id,
      rate: 40_000,
    });
    const accepted = await selection.accept(brand.owner.id, application.id);
    return {
      ...brand,
      creator,
      brief,
      application,
      campaignId: accepted.campaignId,
    };
  }

  it('accepting an application notifies the creator in-app and by email, with the campaign link', async () => {
    const { creator, campaignId } = await acceptedCampaign();
    const rows = await prisma.notification.findMany({
      where: { userId: creator.user.id },
    });
    expect(rows).toEqual([
      expect.objectContaining({
        type: 'application.accepted',
        href: `/app/campaigns/${campaignId}`,
      }),
    ]);
    const emails = sentTo(creator.user.email);
    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain(
      `https://app.woosh.test/app/campaigns/${campaignId}`,
    );
  });

  it('a creator with email notifications off still gets the in-app notification only', async () => {
    const brand = await createFundedBrand(prisma);
    const creator = await createCreator(prisma);
    await prisma.user.update({
      where: { id: creator.user.id },
      data: { emailNotifications: false, weeklyDigest: false },
    });
    const { application } = await createApplication(prisma, {
      brandId: brand.brand.id,
      creatorProfileId: creator.profile.id,
      rate: 10_000,
    });
    await selection.decline(brand.owner.id, application.id);
    expect(
      await prisma.notification.count({
        where: { userId: creator.user.id, type: 'application.declined' },
      }),
    ).toBe(1);
    expect(sentTo(creator.user.email)).toHaveLength(0);
  });

  it('a duplicated Paystack webhook credits once and sends one "wallet funded" email', async () => {
    const { owner, brand } = await createFundedBrand(prisma);
    const input = {
      reference: 'ref_dup_1',
      amountKobo: 5_000_000,
      brandId: brand.id,
    };
    await Promise.all([
      wallets.creditFromPaystack(input),
      wallets.creditFromPaystack(input),
    ]);
    await wallets.creditFromPaystack(input);
    expect(await walletBalance(prisma, brand.id)).toBe(50_000);
    expect(
      await prisma.notification.count({
        where: { userId: owner.id, type: 'wallet.funded' },
      }),
    ).toBe(1);
    const emails = sentTo(owner.email);
    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain('https://app.woosh.test/app/payments');
  });

  it('a Resend outage does not break deliverable approval', async () => {
    const { owner, creator, campaignId } = await acceptedCampaign();
    await prisma.campaignParticipant.updateMany({
      where: { campaignId },
      data: { termsAcceptedAt: new Date() },
    });
    const deliverable = await prisma.deliverable.findFirstOrThrow({
      where: { campaignId },
    });
    await prisma.deliverable.update({
      where: { id: deliverable.id },
      data: { state: 'DRAFT_SUBMITTED' },
    });
    await prisma.submission.create({
      data: {
        deliverableId: deliverable.id,
        version: 1,
        submittedById: creator.user.id,
        draftUrl: 'https://example.com/draft.mp4',
      },
    });
    mail.fail = true;
    await expect(
      deliverables.approve(owner.id, deliverable.id),
    ).resolves.toMatchObject({
      state: 'APPROVED',
    });
    expect(
      await prisma.notification.count({
        where: { userId: creator.user.id, type: 'deliverable.approved' },
      }),
    ).toBe(1);
  });

  it('a creator counter-offer reaches the brand, but not a teammate scoped to another brand', async () => {
    const { owner, organisation, brand } = await createFundedBrand(prisma);
    const otherBrand = await prisma.brand.create({
      data: { organisationId: organisation.id, name: 'Other Brand' },
    });
    const outsider = await prisma.user.create({
      data: {
        email: 'other-brand-manager@test.woosh',
        status: 'ACTIVE',
        emailVerified: new Date(),
      },
    });
    await prisma.membership.create({
      data: {
        organisationId: organisation.id,
        userId: outsider.id,
        role: 'MANAGER',
      },
    });
    await prisma.brandMembership.create({
      data: { brandId: otherBrand.id, userId: outsider.id, role: 'MANAGER' },
    });
    const creator = await createCreator(prisma);
    const { brief, application } = await createApplication(prisma, {
      brandId: brand.id,
      creatorProfileId: creator.profile.id,
      rate: 20_000,
    });

    await selection.counterOffer(
      creator.user.id,
      application.id,
      25_000,
      'Two reels',
    );

    const ownerRows = await prisma.notification.findMany({
      where: { userId: owner.id },
    });
    expect(ownerRows).toEqual([
      expect.objectContaining({
        type: 'offer.countered',
        href: `/app/briefs/${brief.id}`,
      }),
    ]);
    expect(sentTo(owner.email)).toHaveLength(1);
    expect(
      await prisma.notification.count({ where: { userId: outsider.id } }),
    ).toBe(0);
    expect(sentTo(outsider.email)).toHaveLength(0);
  });

  it('new messages send one "message waiting" email per unread thread, without the text', async () => {
    const { owner, creator, application } = await acceptedCampaign();
    mail.sent = [];
    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { applicationId: application.id },
    });
    await messaging.send(
      owner.id,
      conversation.id,
      'Secret launch date is 3 Dec',
    );
    await messaging.send(
      owner.id,
      conversation.id,
      'Also: bring the blue jacket',
    );

    const emails = sentTo(creator.user.email);
    expect(emails).toHaveLength(1);
    expect(emails[0].html).not.toContain('Secret launch date');
    expect(emails[0].text).not.toContain('blue jacket');
    expect(emails[0].html).toContain(
      `https://app.woosh.test/app/messages?c=${conversation.id}`,
    );

    // Opening the thread clears it, so the next message can notify again.
    await messaging.get(creator.user.id, conversation.id);
    await messaging.send(owner.id, conversation.id, 'One more thing');
    expect(sentTo(creator.user.email)).toHaveLength(2);
  });
});
