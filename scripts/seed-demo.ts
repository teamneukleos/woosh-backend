import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { encryptAccountNumber } from "../src/payments/payout-account-crypto";
import { DISCOVERY_CATALOG } from "./discovery-catalog";

function cartoonAvatar(seed: string) {
  const value = seed.trim() || "woosh";
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(value)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.WOOSH_ALLOW_DEMO_SEED !== "true"
  ) {
    throw new Error(
      "Demo seed is blocked in production. Set WOOSH_ALLOW_DEMO_SEED=true only for an isolated disposable database.",
    );
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  const databaseHost = new URL(databaseUrl).hostname;
  if (
    !["localhost", "127.0.0.1", "::1"].includes(databaseHost) &&
    process.env.WOOSH_ALLOW_DEMO_SEED !== "true"
  ) {
    throw new Error(
      "Demo seed is restricted to local databases unless WOOSH_ALLOW_DEMO_SEED=true is explicitly set.",
    );
  }
  process.env.PAYOUT_ACCOUNT_ENCRYPTION_KEY ||=
    "woosh-demo-payout-key-not-for-production";
  const prisma = new PrismaClient();
  const passwordHash = await hash("password123", 12);

  // Clean demo emails
  const demoEmails = [
    "agency@woosh.test",
    "brand@woosh.test",
    "creator@woosh.test",
    "admin@woosh.test",
  ];
  await prisma.financialDocument.deleteMany({
    where: { creator: { user: { email: { in: demoEmails } } } },
  });
  await prisma.ledgerTransaction.deleteMany({
    where: {
      obligation: {
        participant: {
          campaign: { brand: { organisation: { publicName: "Lagos Motion" } } },
        },
      },
    },
  });
  await prisma.paymentObligation.deleteMany({
    where: {
      participant: {
        campaign: { brand: { organisation: { publicName: "Lagos Motion" } } },
      },
    },
  });
  await prisma.campaign.deleteMany({
    where: { brand: { organisation: { publicName: "Lagos Motion" } } },
  });
  await prisma.brief.deleteMany({
    where: { brand: { organisation: { publicName: "Lagos Motion" } } },
  });
  await prisma.brandInterest.deleteMany({
    where: {
      OR: [
        { createdBy: { email: { in: demoEmails } } },
        { brand: { organisation: { publicName: "Lagos Motion" } } },
      ],
    },
  });
  await prisma.auditEvent.deleteMany({
    where: { actor: { email: { in: demoEmails } } },
  });
  await prisma.user.deleteMany({ where: { email: { in: demoEmails } } });
  await prisma.organisation.deleteMany({
    where: { publicName: { in: ["Lagos Motion", "Kora Beauty"] } },
  });
  await prisma.creatorProspect.deleteMany({
    where: {
      handle: { in: ["amaka.creates", "tunde.reels", "zainab.fits"] },
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: "admin@woosh.test",
      name: "Woosh Admin",
      passwordHash,
      status: "ACTIVE",
      emailVerified: new Date(),
      isPlatformAdmin: true,
    },
  });

  const agencyUser = await prisma.user.create({
    data: {
      email: "agency@woosh.test",
      name: "Lagos Agency",
      passwordHash,
      status: "ACTIVE",
      emailVerified: new Date(),
      memberships: {
        create: {
          role: "OWNER",
          canApprovePayments: true,
          canEditRates: true,
          canManageTeam: true,
          canExportData: true,
          organisation: {
            create: {
              type: "AGENCY",
              legalName: "Lagos Motion Agency Ltd",
              publicName: "Lagos Motion",
              country: "NG",
              industry: "Marketing",
              brands: {
                create: {
                  name: "Palm Cola",
                  country: "NG",
                  industry: "FMCG",
                },
              },
            },
          },
        },
      },
    },
    include: {
      memberships: { include: { organisation: { include: { brands: true } } } },
    },
  });

  const brand = agencyUser.memberships[0].organisation.brands[0];
  await prisma.brandMembership.create({
    data: {
      brandId: brand.id,
      userId: agencyUser.id,
      role: "OWNER",
    },
  });

  await prisma.brandWallet.create({
    data: {
      brandId: brand.id,
      balance: 5_000_000,
      currency: "NGN",
    },
  });

  await prisma.organisation.update({
    where: { id: agencyUser.memberships[0].organisationId },
    data: { verifiedAt: new Date() },
  });

  const brandUser = await prisma.user.create({
    data: {
      email: "brand@woosh.test",
      name: "Kora Beauty",
      passwordHash,
      status: "ACTIVE",
      emailVerified: new Date(),
      memberships: {
        create: {
          role: "OWNER",
          canApprovePayments: true,
          canEditRates: true,
          canManageTeam: true,
          canExportData: true,
          organisation: {
            create: {
              type: "BRAND",
              legalName: "Kora Beauty Limited",
              publicName: "Kora Beauty",
              country: "NG",
              industry: "Beauty",
              verifiedAt: new Date(),
              brands: {
                create: {
                  name: "Kora Beauty",
                  country: "NG",
                  industry: "Beauty",
                  wallet: {
                    create: {
                      balance: 2_500_000,
                      currency: "NGN",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    include: {
      memberships: { include: { organisation: { include: { brands: true } } } },
    },
  });
  await prisma.brandMembership.create({
    data: {
      brandId: brandUser.memberships[0].organisation.brands[0].id,
      userId: brandUser.id,
      role: "OWNER",
    },
  });

  const creator = await prisma.user.create({
    data: {
      email: "creator@woosh.test",
      name: "Chioma Okeke",
      passwordHash,
      status: "ACTIVE",
      emailVerified: new Date(),
      creatorProfile: {
        create: {
          displayName: "Chioma Okeke",
          bio: "Lagos lifestyle and fashion creator telling energetic, culture-first stories for ambitious African brands. I specialise in polished short-form video, editorial product photography and warm on-camera reviews.",
          avatarUrl: cartoonAvatar("chioma.okeke"),
          avatarStatus: "APPROVED",
          coverUrl:
            "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=1600&q=85",
          coverStatus: "APPROVED",
          websiteUrl: "https://instagram.com/chioma.okeke",
          locationCountry: "NG",
          locationState: "Lagos",
          locationCity: "Lagos",
          categories: ["Lifestyle", "Fashion"],
          languages: ["English", "Igbo", "Pidgin"],
          availabilityNotes:
            "Available for two retained partnerships and four one-off campaigns per month. Lagos shoots preferred; travel available with notice.",
          profileVisible: true,
          marketplaceStatus: "PUBLISHED",
          verifiedAt: new Date(),
          ratePackages: {
            create: [
              {
                channel: "INSTAGRAM",
                deliverableType: "Reel / Short",
                title: "One story-led Instagram Reel",
                description:
                  "Concept, filming, edit, caption and one revision included.",
                price: 220000,
                currency: "NGN",
                turnaroundDays: 7,
                revisions: 1,
                usageRights: "30 days organic brand usage",
              },
              {
                channel: "TIKTOK",
                deliverableType: "UGC ad",
                title: "Performance UGC video",
                description:
                  "15–30 second vertical video with hook variants and raw export.",
                price: 180000,
                currency: "NGN",
                turnaroundDays: 5,
                revisions: 2,
                usageRights: "90 days paid social usage",
              },
              {
                channel: "YOUTUBE",
                deliverableType: "Product review",
                title: "YouTube integration",
                description: "60–90 second integrated product story.",
                price: 350000,
                currency: "NGN",
                turnaroundDays: 10,
                revisions: 1,
                usageRights: "Organic usage",
              },
            ],
          },
          portfolioItems: {
            create: [
              {
                mediaType: "IMAGE",
                title: "Editorial beauty story",
                description:
                  "Art direction and product-led photography for a Lagos beauty launch.",
                channel: "INSTAGRAM",
                campaignType: "Feed post",
                brandName: "Demo Beauty",
                tags: ["beauty", "editorial", "product"],
                url: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1200&q=85",
                sortOrder: 0,
                status: "APPROVED",
              },
              {
                mediaType: "IMAGE",
                title: "City style campaign",
                description:
                  "Street-style photography and styling built for a fashion carousel.",
                channel: "INSTAGRAM",
                campaignType: "Feed post",
                brandName: "Demo Fashion",
                tags: ["fashion", "lagos", "style"],
                url: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1200&q=85",
                sortOrder: 1,
                status: "APPROVED",
              },
              {
                mediaType: "VIDEO",
                title: "Lifestyle product film",
                description:
                  "Fast-paced vertical product story with on-camera moments.",
                channel: "TIKTOK",
                campaignType: "UGC ad",
                brandName: "Demo Drinks",
                tags: ["ugc", "lifestyle", "video"],
                url: "https://videos.pexels.com/video-files/853800/853800-hd_1920_1080_30fps.mp4",
                mimeType: "video/mp4",
                sortOrder: 2,
                status: "APPROVED",
              },
              {
                mediaType: "EMBED",
                title: "Long-form creator story",
                description:
                  "Sample YouTube storytelling format and on-camera delivery.",
                channel: "YOUTUBE",
                campaignType: "Product review",
                tags: ["youtube", "review"],
                url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                sortOrder: 3,
                status: "APPROVED",
              },
            ],
          },
          socialAccounts: {
            create: [
              {
                channel: "INSTAGRAM",
                externalId: "dev_instagram_chioma",
                handle: "chioma.okeke",
                status: "ACTIVE",
                lastRefreshedAt: new Date(),
                snapshots: {
                  create: [
                    {
                      source: "dev_oauth",
                      capturedAt: new Date(Date.now() - 60 * 86400000),
                      followers: 112400,
                      engagementRate: 4.6,
                      averageViews: 74500,
                    },
                    {
                      source: "dev_oauth",
                      capturedAt: new Date(Date.now() - 30 * 86400000),
                      followers: 116800,
                      engagementRate: 4.8,
                      averageViews: 79100,
                    },
                    {
                      source: "dev_oauth",
                      followers: 120600,
                      engagementRate: 5.1,
                      averageViews: 82400,
                      postingFrequency: 4.5,
                      audienceGeo: {
                        Lagos: 42,
                        Abuja: 18,
                        Accra: 11,
                        London: 7,
                      },
                      audienceAge: {
                        "18-24": 31,
                        "25-34": 49,
                        "35-44": 15,
                      },
                      audienceGender: { Women: 68, Men: 31, Other: 1 },
                    },
                  ],
                },
              },
              {
                channel: "TIKTOK",
                externalId: "dev_tiktok_chioma",
                handle: "chioma.creates",
                status: "ACTIVE",
                lastRefreshedAt: new Date(),
                snapshots: {
                  create: {
                    source: "dev_oauth",
                    followers: 89400,
                    engagementRate: 7.3,
                    averageViews: 108000,
                    postingFrequency: 5.2,
                  },
                },
              },
              {
                channel: "YOUTUBE",
                externalId: "dev_youtube_chioma",
                handle: "ChiomaCreates",
                status: "ACTIVE",
                lastRefreshedAt: new Date(),
                snapshots: {
                  create: {
                    source: "dev_oauth",
                    followers: 28700,
                    engagementRate: 4.1,
                    averageViews: 31500,
                    postingFrequency: 1.5,
                  },
                },
              },
            ],
          },
        },
      },
    },
  });

  const prospects = [];
  for (const row of DISCOVERY_CATALOG) {
    prospects.push(
      await prisma.creatorProspect.upsert({
        where: {
          channel_handle: { channel: row.channel, handle: row.handle },
        },
        create: {
          channel: row.channel,
          handle: row.handle,
          displayName: row.displayName,
          locationCountry: "NG",
          locationCity: row.locationCity,
          categories: row.categories,
          followerEstimate: row.followers,
          status: "UNCLAIMED",
        },
        update: {
          displayName: row.displayName,
          locationCity: row.locationCity,
          categories: row.categories,
          followerEstimate: row.followers,
        },
      }),
    );
  }

  const brief = await prisma.brief.create({
    data: {
      brandId: brand.id,
      title: "Palm Cola Summer Splash",
      description:
        "Looking for creators to showcase Palm Cola in everyday Lagos moments. 1 feed post + 1 story.",
      objective: "Awareness among 18-34 urban Nigeria",
      category: "FMCG",
      status: "OPEN",
      distribution: "OPEN",
      rateMode: "FIXED_NEGOTIABLE",
      rateAmount: 150000,
      currency: "NGN",
      channels: ["INSTAGRAM", "TIKTOK"],
      deliverables: [
        { title: "Feed post", channel: "INSTAGRAM" },
        { title: "Story frame", channel: "INSTAGRAM" },
      ],
      publishedAt: new Date(),
    },
  });

  const creatorProfile = await prisma.creatorProfile.findUniqueOrThrow({
    where: { userId: creator.id },
  });
  await prisma.creatorPayoutAccount.create({
    data: {
      creatorProfileId: creatorProfile.id,
      bankCode: "058",
      bankName: "Guaranty Trust Bank",
      accountName: "Chioma Okeke",
      encryptedAccountNumber: encryptAccountNumber("0123456789"),
      accountNumberLast4: "6789",
      recipientCode: `DEV_${creatorProfile.id}`,
      verifiedAt: new Date(),
      verificationReference: "seed_verified",
    },
  });
  const expiringBrief = await prisma.brief.create({
    data: {
      brandId: brand.id,
      title: "Weekend Street Style",
      description:
        "A fast-turnaround street style activation for Lagos Fashion Week.",
      status: "OPEN",
      distribution: "INVITE_ONLY",
      rateMode: "FIXED_NEGOTIABLE",
      rateAmount: 175000,
      currency: "NGN",
      channels: ["INSTAGRAM"],
      applicationDeadline: new Date(Date.now() + 2 * 86_400_000),
      publishedAt: new Date(),
      deliverables: [{ title: "Street style Reel", channel: "INSTAGRAM" }],
    },
  });
  await prisma.briefInvitation.create({
    data: {
      briefId: expiringBrief.id,
      creatorProfileId: creatorProfile.id,
      status: "SENT",
      message: "Your visual style is a strong fit for this quick campaign.",
    },
  });
  const declinedInviteBrief = await prisma.brief.create({
    data: {
      brandId: brand.id,
      title: "Midnight Launch Event",
      description:
        "Attend and cover a late-night product launch with same-night stories.",
      status: "OPEN",
      distribution: "INVITE_ONLY",
      rateMode: "FIXED_NON_NEGOTIABLE",
      rateAmount: 90000,
      currency: "NGN",
      channels: ["INSTAGRAM"],
      applicationDeadline: new Date(Date.now() + 5 * 86_400_000),
      publishedAt: new Date(),
    },
  });
  await prisma.briefInvitation.create({
    data: {
      briefId: declinedInviteBrief.id,
      creatorProfileId: creatorProfile.id,
      status: "DECLINED",
      respondedAt: new Date(),
      responseReason: "The event conflicts with an existing production.",
    },
  });
  const negotiationBrief = await prisma.brief.create({
    data: {
      brandId: brand.id,
      title: "Palm Cola Creator Diary",
      description:
        "A three-part creator diary featuring relaxed moments with Palm Cola.",
      status: "SELECTING",
      distribution: "HYBRID",
      rateMode: "RANGE_NEGOTIABLE",
      rateMin: 180000,
      rateMax: 260000,
      currency: "NGN",
      channels: ["TIKTOK"],
      applicationDeadline: new Date(Date.now() + 10 * 86_400_000),
      publishedAt: new Date(),
    },
  });
  await prisma.application.create({
    data: {
      briefId: negotiationBrief.id,
      creatorProfileId: creatorProfile.id,
      status: "SHORTLISTED",
      proposedRate: 250000,
      currency: "NGN",
      availabilityNote: "Can begin pre-production this week.",
      offers: {
        create: {
          amount: 225000,
          currency: "NGN",
          status: "COUNTERED",
          createdById: agencyUser.id,
          message: "Can we meet at 225k including one revision round?",
        },
      },
    },
  });
  const appliedBrief = await prisma.brief.create({
    data: {
      brandId: brand.id,
      title: "Taste Test Shorts",
      description:
        "Natural reaction-led short videos for a new seasonal flavour.",
      status: "OPEN",
      distribution: "OPEN",
      rateMode: "FIXED_NEGOTIABLE",
      rateAmount: 120000,
      currency: "NGN",
      channels: ["TIKTOK"],
      applicationDeadline: new Date(Date.now() + 14 * 86_400_000),
      publishedAt: new Date(),
    },
  });
  await prisma.application.create({
    data: {
      briefId: appliedBrief.id,
      creatorProfileId: creatorProfile.id,
      status: "APPLIED",
      proposedRate: 135000,
      currency: "NGN",
      availabilityNote: "Available next week.",
      offers: {
        create: {
          amount: 135000,
          currency: "NGN",
          status: "OPEN",
          createdById: creator.id,
          message: "Creator proposed rate",
        },
      },
    },
  });
  await prisma.application.create({
    data: {
      briefId: brief.id,
      creatorProfileId: creatorProfile.id,
      status: "ACCEPTED",
      proposedRate: 200000,
      currency: "NGN",
      availabilityNote: "Ready to deliver within seven days.",
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      briefId: brief.id,
      brandId: brand.id,
      title: "Palm Cola Summer Splash",
      status: "ACTIVE",
    },
  });
  const participant = await prisma.campaignParticipant.create({
    data: {
      campaignId: campaign.id,
      creatorProfileId: creatorProfile.id,
      agreedRate: 200000,
      currency: "NGN",
      termsAcceptedAt: new Date(),
    },
  });
  await prisma.conversation.create({
    data: {
      type: "CAMPAIGN",
      campaignId: campaign.id,
      messages: {
        create: [
          {
            isSystem: true,
            body: "Campaign opened for Chioma Okeke",
          },
          {
            senderUserId: agencyUser.id,
            body: "Welcome, Chioma. Please keep the product visible in the first three seconds.",
          },
          {
            senderUserId: creator.id,
            body: "Got it — I’ll share the first cut tomorrow afternoon.",
          },
        ],
      },
    },
  });
  await prisma.deliverable.create({
    data: {
      campaignId: campaign.id,
      campaignParticipantId: participant.id,
      title: "Opening story frames",
      channel: "INSTAGRAM",
      requirements: {
        frames: 3,
        note: "Product visible in frame one with campaign tag.",
      },
      state: "IN_PROGRESS",
      startedAt: new Date(Date.now() - 4 * 86_400_000),
      dueAt: new Date(Date.now() - 86_400_000),
    },
  });
  await prisma.deliverable.create({
    data: {
      campaignId: campaign.id,
      campaignParticipantId: participant.id,
      title: "Behind-the-scenes Reel",
      channel: "INSTAGRAM",
      state: "REVISION_REQUESTED",
      startedAt: new Date(Date.now() - 3 * 86_400_000),
      dueAt: new Date(Date.now() + 2 * 86_400_000),
      submissions: {
        create: {
          submittedById: creator.id,
          version: 1,
          draftUrl: "https://drive.google.com/file/d/woosh-demo-revision",
          notes: "First edit with original audio.",
          reviewNotes:
            "Please move the product close-up before the six-second mark.",
          reviewedAt: new Date(),
        },
      },
    },
  });
  await prisma.deliverable.create({
    data: {
      campaignId: campaign.id,
      campaignParticipantId: participant.id,
      title: "Product still",
      channel: "INSTAGRAM",
      state: "APPROVED",
      startedAt: new Date(Date.now() - 5 * 86_400_000),
      dueAt: new Date(Date.now() + 4 * 86_400_000),
      submissions: {
        create: {
          submittedById: creator.id,
          version: 1,
          draftUrl: "https://images.unsplash.com/photo-1544145945-f90425340c7e",
          fileName: "palm-cola-product-still.jpg",
          mimeType: "image/jpeg",
          fileSizeBytes: 2_400_000,
          reviewedAt: new Date(),
        },
      },
    },
  });
  await prisma.deliverable.create({
    data: {
      campaignId: campaign.id,
      campaignParticipantId: participant.id,
      title: "Launch teaser",
      channel: "INSTAGRAM",
      state: "COMPLETED",
      startedAt: new Date(Date.now() - 12 * 86_400_000),
      completedAt: new Date(Date.now() - 7 * 86_400_000),
      dueAt: new Date(Date.now() - 8 * 86_400_000),
      submissions: {
        create: {
          submittedById: creator.id,
          version: 1,
          draftUrl: "https://instagram.com/p/demo-teaser",
          liveUrl: "https://instagram.com/p/demo-teaser",
          reviewedAt: new Date(Date.now() - 8 * 86_400_000),
        },
      },
    },
  });
  const deliverable = await prisma.deliverable.create({
    data: {
      campaignId: campaign.id,
      campaignParticipantId: participant.id,
      title: "Summer lifestyle Reel",
      channel: "INSTAGRAM",
      state: "LIVE",
      submissions: {
        create: {
          submittedById: creator.id,
          version: 1,
          draftUrl: "https://instagram.com/p/demo",
          liveUrl: "https://instagram.com/p/demo",
          reviewedAt: new Date(),
        },
      },
    },
    include: { submissions: true },
  });
  const submission = deliverable.submissions[0];
  if (participant && deliverable) {
    const obligation = await prisma.paymentObligation.create({
      data: {
        campaignParticipantId: participant.id,
        grossAmount: 200000,
        platformFee: 0,
        netAmount: 200000,
        currency: "NGN",
        status: "PAID",
        approvedAt: new Date(Date.now() - 10 * 86_400_000),
        availableAt: new Date(Date.now() - 7 * 86_400_000),
        processingAt: new Date(Date.now() - 6 * 86_400_000),
        paidAt: new Date(Date.now() - 6 * 86_400_000),
      },
    });
    await prisma.ledgerTransaction.create({
      data: {
        obligationId: obligation.id,
        type: "PAYOUT",
        amount: 200000,
        currency: "NGN",
        status: "SUCCEEDED",
        provider: "test_mode",
        providerReference: `seed_${obligation.id}`,
        idempotencyKey: `seed_${obligation.id}`,
        completedAt: new Date(Date.now() - 6 * 86_400_000),
      },
    });
    await prisma.financialDocument.create({
      data: {
        documentNumber: `WO-REC-SEED-${obligation.id.slice(-6).toUpperCase()}`,
        type: "BRAND_RECEIPT",
        creatorProfileId: creatorProfile.id,
        brandId: brand.id,
        obligationId: obligation.id,
        grossAmount: 200000,
        feeAmount: 20000,
        netAmount: 180000,
        currency: "NGN",
        dedupeKey: `receipt:${obligation.id}`,
        snapshot: {
          campaign: campaign.title,
          brand: brand.name,
          creator: creatorProfile.displayName,
          paidAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
        },
      },
    });
    await prisma.campaignMetric.create({
      data: {
        campaignId: campaign.id,
        creatorProfileId: creatorProfile.id,
        deliverableId: deliverable.id,
        submissionId: submission?.id,
        postUrl: submission?.liveUrl,
        source: "manual_demo",
        reach: 96500,
        impressions: 142000,
        views: 118400,
        engagement: 7600,
      },
    });
  }
  const financeScenarios = [
    {
      title: "Release window — City Picnic",
      status: "APPROVED" as const,
      availableAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
    {
      title: "Processing — Studio Taste Test",
      status: "PROCESSING" as const,
      availableAt: new Date(Date.now() - 2 * 86_400_000),
    },
    {
      title: "Failed payout — Night Market",
      status: "FAILED" as const,
      availableAt: new Date(Date.now() - 3 * 86_400_000),
    },
    {
      title: "Disputed — Product Styling",
      status: "DISPUTED" as const,
      availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    {
      title: "Refunded — Cancelled Pop-up",
      status: "REVERSED" as const,
      availableAt: new Date(Date.now() - 4 * 86_400_000),
    },
  ];
  for (const scenario of financeScenarios) {
    const scenarioBrief = await prisma.brief.create({
      data: {
        brandId: brand.id,
        title: scenario.title,
        description: `Finance lifecycle fixture for ${scenario.title}.`,
        status: "CLOSED",
        distribution: "INVITE_ONLY",
        rateMode: "FIXED_NON_NEGOTIABLE",
        rateAmount: 100000,
        currency: "NGN",
        channels: ["INSTAGRAM"],
        publishedAt: new Date(Date.now() - 20 * 86_400_000),
      },
    });
    const scenarioCampaign = await prisma.campaign.create({
      data: {
        briefId: scenarioBrief.id,
        brandId: brand.id,
        title: scenario.title,
        status: scenario.status === "REVERSED" ? "CANCELLED" : "COMPLETED",
      },
    });
    const scenarioParticipant = await prisma.campaignParticipant.create({
      data: {
        campaignId: scenarioCampaign.id,
        creatorProfileId: creatorProfile.id,
        agreedRate: 100000,
        currency: "NGN",
        status: scenario.status === "REVERSED" ? "TERMINATED" : "COMPLETED",
        termsAcceptedAt: new Date(Date.now() - 15 * 86_400_000),
      },
    });
    await prisma.deliverable.create({
      data: {
        campaignId: scenarioCampaign.id,
        campaignParticipantId: scenarioParticipant.id,
        title: "Campaign deliverable",
        state: scenario.status === "REVERSED" ? "REJECTED" : "COMPLETED",
        startedAt: new Date(Date.now() - 14 * 86_400_000),
        completedAt: new Date(Date.now() - 5 * 86_400_000),
      },
    });
    const scenarioObligation = await prisma.paymentObligation.create({
      data: {
        campaignParticipantId: scenarioParticipant.id,
        grossAmount: 100000,
        platformFee: 0,
        netAmount: 100000,
        currency: "NGN",
        status: scenario.status,
        approvedAt: new Date(Date.now() - 8 * 86_400_000),
        availableAt: scenario.availableAt,
        processingAt:
          scenario.status === "PROCESSING"
            ? new Date(Date.now() - 10 * 60 * 1000)
            : undefined,
        failedAt:
          scenario.status === "FAILED"
            ? new Date(Date.now() - 2 * 86_400_000)
            : undefined,
        failureReason:
          scenario.status === "FAILED"
            ? "Beneficiary bank temporarily unavailable"
            : undefined,
        reversedAt:
          scenario.status === "REVERSED"
            ? new Date(Date.now() - 3 * 86_400_000)
            : undefined,
        reversalReason:
          scenario.status === "REVERSED"
            ? "Campaign cancelled before publication"
            : undefined,
      },
    });
    if (scenario.status === "PROCESSING" || scenario.status === "FAILED") {
      await prisma.ledgerTransaction.create({
        data: {
          obligationId: scenarioObligation.id,
          type: "PAYOUT",
          amount: 100000,
          currency: "NGN",
          status: scenario.status === "PROCESSING" ? "PENDING" : "FAILED",
          provider: "paystack",
          providerReference: `seed_${scenario.status.toLowerCase()}_${scenarioObligation.id}`,
          idempotencyKey: `seed_${scenario.status.toLowerCase()}_${scenarioObligation.id}`,
          failureReason:
            scenario.status === "FAILED"
              ? "Beneficiary bank temporarily unavailable"
              : undefined,
        },
      });
    }
    if (scenario.status === "DISPUTED" || scenario.status === "REVERSED") {
      await prisma.dispute.create({
        data: {
          raisedById: creator.id,
          resolvedById: scenario.status === "REVERSED" ? admin.id : undefined,
          obligationId: scenarioObligation.id,
          campaignId: scenarioCampaign.id,
          category:
            scenario.status === "REVERSED" ? "CANCELLATION" : "PAYMENT_AMOUNT",
          subject:
            scenario.status === "REVERSED"
              ? "Cancelled campaign refund"
              : "Payment amount needs review",
          description:
            "The agreed campaign payment requires platform review before funds move.",
          status: scenario.status === "REVERSED" ? "RESOLVED" : "OPEN",
          responseDueAt: new Date(Date.now() + 2 * 86_400_000),
          resolutionType:
            scenario.status === "REVERSED" ? "REFUND_BRAND" : undefined,
          resolution:
            scenario.status === "REVERSED"
              ? "Campaign cancelled and committed funds returned to brand wallet."
              : undefined,
          resolvedAt:
            scenario.status === "REVERSED" ? new Date() : undefined,
        },
      });
    }
    if (scenario.status === "REVERSED") {
      await prisma.ledgerTransaction.create({
        data: {
          obligationId: scenarioObligation.id,
          type: "REFUND",
          amount: 110000,
          currency: "NGN",
          status: "SUCCEEDED",
          provider: "woosh_ledger",
          providerReference: `seed_refund_${scenarioObligation.id}`,
          idempotencyKey: `seed_refund_${scenarioObligation.id}`,
          completedAt: new Date(),
          metadata: { brandId: brand.id },
        },
      });
    }
  }
  await prisma.analyticsEvent.createMany({
    data: [
      ...Array.from({ length: 18 }, (_, index) => ({
        eventType: "PROFILE_VIEW" as const,
        actorUserId: agencyUser.id,
        organisationId: agencyUser.memberships[0].organisationId,
        brandId: brand.id,
        creatorProfileId: creatorProfile.id,
        createdAt: new Date(Date.now() - index * 86400000),
      })),
      {
        eventType: "CREATOR_SAVED" as const,
        actorUserId: agencyUser.id,
        organisationId: agencyUser.memberships[0].organisationId,
        brandId: brand.id,
        creatorProfileId: creatorProfile.id,
      },
      {
        eventType: "APPLICATION_ACCEPTED" as const,
        actorUserId: agencyUser.id,
        brandId: brand.id,
        creatorProfileId: creatorProfile.id,
        briefId: brief.id,
        campaignId: campaign.id,
      },
      {
        eventType: "CONTENT_LIVE" as const,
        actorUserId: agencyUser.id,
        brandId: brand.id,
        creatorProfileId: creatorProfile.id,
        campaignId: campaign.id,
      },
    ],
  });

  console.log("Seeded demo:");
  console.log("  admin@", admin.email, "(isPlatformAdmin)");
  console.log("  agency@", agencyUser.email, "brand=", brand.name);
  console.log(
    "  brand@",
    brandUser.email,
    "brand=",
    brandUser.memberships[0].organisation.brands[0].name,
  );
  console.log("  creator@", creator.email);
  console.log("  prospects=", prospects.map((p) => p.handle).join(", "));
  console.log("  brief=", brief.title, brief.id);
  console.log("  password for all: password123");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
