-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ACTIVE', 'AWAITING_APPROVAL', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "DeliverableState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DRAFT_SUBMITTED', 'REVISION_REQUESTED', 'RESUBMITTED', 'APPROVED', 'SCHEDULED', 'LIVE', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SocialChannel" AS ENUM ('INSTAGRAM', 'TIKTOK', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "SocialConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'PENDING');

-- CreateEnum
CREATE TYPE "CreatorMarketplaceStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CreatorMediaStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "PortfolioMediaType" AS ENUM ('IMAGE', 'VIDEO', 'EMBED');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('UNCLAIMED', 'CLAIM_PENDING', 'CLAIMED');

-- CreateEnum
CREATE TYPE "BrandInterestStatus" AS ENUM ('OPEN', 'INVITED', 'CLAIMED', 'CLOSED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('DRAFT', 'PENDING_MODERATION', 'OPEN', 'SELECTING', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BriefDistribution" AS ENUM ('OPEN', 'INVITE_ONLY', 'HYBRID');

-- CreateEnum
CREATE TYPE "RateMode" AS ENUM ('FIXED_NON_NEGOTIABLE', 'FIXED_NEGOTIABLE', 'RANGE_NEGOTIABLE', 'DELIVERABLE_BASED', 'CREATOR_BUNDLE');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('APPLIED', 'SHORTLISTED', 'DECLINED', 'ACCEPTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('OPEN', 'COUNTERED', 'AGREED', 'EXPIRED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('APPLICATION', 'INVITATION', 'CAMPAIGN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "OrganisationType" AS ENUM ('BRAND', 'AGENCY', 'PLATFORM');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'FINANCE', 'VIEWER', 'ACCOUNT_MANAGER');

-- CreateEnum
CREATE TYPE "PlanAudience" AS ENUM ('BRAND', 'AGENCY');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('PENDING_FUNDING', 'FUNDED', 'COMMITTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('COLLECTION', 'FEE', 'PAYOUT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisputeCategory" AS ENUM ('CONTENT_APPROVAL', 'PAYMENT_AMOUNT', 'PAYOUT_DELAY', 'CANCELLATION', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeResolutionType" AS ENUM ('RELEASE_PAYOUT', 'REFUND_BRAND');

-- CreateEnum
CREATE TYPE "FinancialDocumentType" AS ENUM ('CREATOR_STATEMENT', 'BRAND_RECEIPT');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('PROFILE_VIEW', 'CREATOR_SAVED', 'CREATOR_UNSAVED', 'INVITE_SENT', 'INVITE_VIEWED', 'INVITE_ACCEPTED', 'INVITE_DECLINED', 'APPLICATION_SUBMITTED', 'APPLICATION_SHORTLISTED', 'APPLICATION_ACCEPTED', 'APPLICATION_DECLINED', 'APPLICATION_WITHDRAWN', 'OFFER_COUNTERED', 'TERMS_ACCEPTED', 'DELIVERABLE_SUBMITTED', 'REVISION_REQUESTED', 'CAMPAIGN_STARTED', 'DELIVERABLE_APPROVED', 'CONTENT_LIVE', 'CAMPAIGN_COMPLETED');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignParticipant" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "agreedRate" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "termsAcceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignParticipantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" "SocialChannel",
    "requirements" JSONB,
    "dueAt" TIMESTAMP(3),
    "state" "DeliverableState" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "submittedById" TEXT,
    "draftUrl" TEXT,
    "liveUrl" TEXT,
    "storageKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "idempotencyKey" TEXT,
    "notes" TEXT,
    "reviewNotes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "avatarStorageKey" TEXT,
    "avatarStatus" "CreatorMediaStatus" NOT NULL DEFAULT 'PENDING',
    "coverUrl" TEXT,
    "coverStorageKey" TEXT,
    "coverStatus" "CreatorMediaStatus" NOT NULL DEFAULT 'PENDING',
    "websiteUrl" TEXT,
    "locationCountry" TEXT,
    "locationState" TEXT,
    "locationCity" TEXT,
    "ageBand" TEXT,
    "gender" TEXT,
    "genderSearchable" BOOLEAN NOT NULL DEFAULT false,
    "ageSearchable" BOOLEAN NOT NULL DEFAULT false,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredIndustries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedIndustries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "typicalRateMin" DECIMAL(12,2),
    "typicalRateMax" DECIMAL(12,2),
    "rateCurrency" TEXT NOT NULL DEFAULT 'NGN',
    "availabilityNotes" TEXT,
    "profileVisible" BOOLEAN NOT NULL DEFAULT false,
    "marketplaceStatus" "CreatorMarketplaceStatus" NOT NULL DEFAULT 'DRAFT',
    "moderationNotes" TEXT,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPortfolioItem" (
    "id" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "mediaType" "PortfolioMediaType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "channel" "SocialChannel",
    "campaignType" TEXT,
    "brandName" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url" TEXT NOT NULL,
    "storageKey" TEXT,
    "thumbnailUrl" TEXT,
    "thumbnailStorageKey" TEXT,
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "CreatorMediaStatus" NOT NULL DEFAULT 'PENDING',
    "moderationNotes" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "moderatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorPortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorRatePackage" (
    "id" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "channel" "SocialChannel" NOT NULL,
    "deliverableType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "turnaroundDays" INTEGER,
    "revisions" INTEGER NOT NULL DEFAULT 1,
    "usageRights" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorRatePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorProspect" (
    "id" TEXT NOT NULL,
    "channel" "SocialChannel" NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "locationCountry" TEXT,
    "locationCity" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "followerEstimate" INTEGER,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "status" "ProspectStatus" NOT NULL DEFAULT 'UNCLAIMED',
    "claimedProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandInterest" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "prospectId" TEXT,
    "creatorProfileId" TEXT,
    "message" TEXT,
    "status" "BrandInterestStatus" NOT NULL DEFAULT 'OPEN',
    "claimToken" TEXT NOT NULL,
    "claimTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "channel" "SocialChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" "SocialConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMetricSnapshot" (
    "id" TEXT NOT NULL,
    "socialAccountId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "followers" INTEGER,
    "engagementRate" DECIMAL(8,4),
    "averageViews" INTEGER,
    "postingFrequency" DECIMAL(8,2),
    "audienceGeo" JSONB,
    "audienceAge" JSONB,
    "audienceGender" JSONB,
    "topContent" JSONB,
    "raw" JSONB,

    CONSTRAINT "SocialMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorList" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorListItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "creatorProfileId" TEXT,
    "prospectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorListBrand" (
    "listId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,

    CONSTRAINT "CreatorListBrand_pkey" PRIMARY KEY ("listId","brandId")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "phone" TEXT,
    "phoneVerified" TIMESTAMP(3),
    "passwordHash" TEXT,
    "name" TEXT,
    "image" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "weeklyDigest" BOOLEAN NOT NULL DEFAULT true,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "expiresAt" INTEGER,
    "tokenType" TEXT,
    "scope" TEXT,
    "idToken" TEXT,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brief" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "internalReference" TEXT,
    "objective" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "status" "BriefStatus" NOT NULL DEFAULT 'DRAFT',
    "distribution" "BriefDistribution" NOT NULL DEFAULT 'OPEN',
    "rateMode" "RateMode" NOT NULL DEFAULT 'FIXED_NON_NEGOTIABLE',
    "rateAmount" DECIMAL(12,2),
    "rateMin" DECIMAL(12,2),
    "rateMax" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "channels" "SocialChannel"[],
    "eligibility" JSONB,
    "deliverables" JSONB,
    "rights" JSONB,
    "timing" JSONB,
    "screeningQuestions" JSONB,
    "applicationDeadline" TIMESTAMP(3),
    "maxCreators" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefInvitation" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'SENT',
    "message" TEXT,
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "answers" JSONB,
    "availabilityNote" TEXT,
    "proposedRate" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "withdrawnAt" TIMESTAMP(3),
    "withdrawalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "message" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "previousOfferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "applicationId" TEXT,
    "campaignId" TEXT,
    "brandId" TEXT,
    "creatorProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "body" TEXT,
    "attachments" JSONB,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "offerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "type" "OrganisationType" NOT NULL,
    "legalName" TEXT NOT NULL,
    "publicName" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "industry" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "canApprovePayments" BOOLEAN NOT NULL DEFAULT false,
    "canEditRates" BOOLEAN NOT NULL DEFAULT false,
    "canManageTeam" BOOLEAN NOT NULL DEFAULT false,
    "canExportData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "industry" TEXT,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "clientHasAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandMembership" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'MANAGER',
    "token" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "audience" "PlanAudience" NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "briefsPerMonth" INTEGER NOT NULL,
    "clientBrandLimit" INTEGER NOT NULL DEFAULT 1,
    "seatLimit" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganisationSubscription" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "briefsUsedThisPeriod" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL DEFAULT 'paystack',
    "providerReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganisationSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandWallet" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPayoutAccount" (
    "id" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumber" TEXT,
    "encryptedAccountNumber" TEXT,
    "accountNumberLast4" TEXT,
    "accountName" TEXT,
    "bankName" TEXT,
    "recipientCode" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationReference" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorPayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentObligation" (
    "id" TEXT NOT NULL,
    "campaignParticipantId" TEXT NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "platformFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "ObligationStatus" NOT NULL DEFAULT 'PENDING_FUNDING',
    "approvedAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "obligationId" TEXT,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'paystack',
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "obligationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "category" "DisputeCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requestedResolution" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "evidence" JSONB,
    "resolution" TEXT,
    "resolutionType" "DisputeResolutionType",
    "responseDueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialDocument" (
    "id" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "type" "FinancialDocumentType" NOT NULL,
    "creatorProfileId" TEXT,
    "brandId" TEXT,
    "obligationId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "feeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMetric" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorProfileId" TEXT,
    "deliverableId" TEXT,
    "submissionId" TEXT,
    "postUrl" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "reach" INTEGER,
    "impressions" INTEGER,
    "views" INTEGER,
    "engagement" INTEGER,
    "raw" JSONB,

    CONSTRAINT "CampaignMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventType" "AnalyticsEventType" NOT NULL,
    "actorUserId" TEXT,
    "organisationId" TEXT,
    "brandId" TEXT,
    "creatorProfileId" TEXT,
    "briefId" TEXT,
    "campaignId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "reference" TEXT,
    "payload" JSONB NOT NULL,
    "signature" TEXT,
    "processedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignParticipant_campaignId_creatorProfileId_key" ON "CampaignParticipant"("campaignId", "creatorProfileId");

-- CreateIndex
CREATE INDEX "Deliverable_campaignParticipantId_state_dueAt_idx" ON "Deliverable"("campaignParticipantId", "state", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_idempotencyKey_key" ON "Submission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Submission_submittedById_submittedAt_idx" ON "Submission"("submittedById", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_deliverableId_version_key" ON "Submission"("deliverableId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE INDEX "CreatorPortfolioItem_creatorProfileId_status_sortOrder_idx" ON "CreatorPortfolioItem"("creatorProfileId", "status", "sortOrder");

-- CreateIndex
CREATE INDEX "CreatorRatePackage_creatorProfileId_active_sortOrder_idx" ON "CreatorRatePackage"("creatorProfileId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProspect_claimedProfileId_key" ON "CreatorProspect"("claimedProfileId");

-- CreateIndex
CREATE INDEX "CreatorProspect_status_idx" ON "CreatorProspect"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProspect_channel_handle_key" ON "CreatorProspect"("channel", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "BrandInterest_claimToken_key" ON "BrandInterest"("claimToken");

-- CreateIndex
CREATE INDEX "BrandInterest_brandId_status_idx" ON "BrandInterest"("brandId", "status");

-- CreateIndex
CREATE INDEX "BrandInterest_prospectId_idx" ON "BrandInterest"("prospectId");

-- CreateIndex
CREATE INDEX "SocialAccount_creatorProfileId_channel_idx" ON "SocialAccount"("creatorProfileId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_channel_externalId_key" ON "SocialAccount"("channel", "externalId");

-- CreateIndex
CREATE INDEX "SocialMetricSnapshot_socialAccountId_capturedAt_idx" ON "SocialMetricSnapshot"("socialAccountId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorListItem_listId_creatorProfileId_key" ON "CreatorListItem"("listId", "creatorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorListItem_listId_prospectId_key" ON "CreatorListItem"("listId", "prospectId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key" ON "OAuthAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "RefreshToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Brief_brandId_status_idx" ON "Brief"("brandId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BriefInvitation_briefId_creatorProfileId_key" ON "BriefInvitation"("briefId", "creatorProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_briefId_creatorProfileId_key" ON "Application"("briefId", "creatorProfileId");

-- CreateIndex
CREATE INDEX "Offer_applicationId_createdAt_idx" ON "Offer"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_applicationId_key" ON "Conversation"("applicationId");

-- CreateIndex
CREATE INDEX "Conversation_campaignId_creatorProfileId_idx" ON "Conversation"("campaignId", "creatorProfileId");

-- CreateIndex
CREATE INDEX "Conversation_brandId_creatorProfileId_idx" ON "Conversation"("brandId", "creatorProfileId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organisationId_userId_key" ON "Membership"("organisationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandMembership_brandId_userId_key" ON "BrandMembership"("brandId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_token_key" ON "TeamInvite"("token");

-- CreateIndex
CREATE INDEX "TeamInvite_email_idx" ON "TeamInvite"("email");

-- CreateIndex
CREATE INDEX "TeamInvite_organisationId_idx" ON "TeamInvite"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "OrganisationSubscription_organisationId_key" ON "OrganisationSubscription"("organisationId");

-- CreateIndex
CREATE INDEX "OrganisationSubscription_status_currentPeriodEnd_idx" ON "OrganisationSubscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "BrandWallet_brandId_key" ON "BrandWallet"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorPayoutAccount_creatorProfileId_key" ON "CreatorPayoutAccount"("creatorProfileId");

-- CreateIndex
CREATE INDEX "PaymentObligation_status_availableAt_idx" ON "PaymentObligation"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentObligation_campaignParticipantId_key" ON "PaymentObligation"("campaignParticipantId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerTransaction_providerReference_idx" ON "LedgerTransaction"("providerReference");

-- CreateIndex
CREATE INDEX "Dispute_obligationId_status_idx" ON "Dispute"("obligationId", "status");

-- CreateIndex
CREATE INDEX "Dispute_status_responseDueAt_idx" ON "Dispute"("status", "responseDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialDocument_documentNumber_key" ON "FinancialDocument"("documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialDocument_dedupeKey_key" ON "FinancialDocument"("dedupeKey");

-- CreateIndex
CREATE INDEX "FinancialDocument_creatorProfileId_generatedAt_idx" ON "FinancialDocument"("creatorProfileId", "generatedAt");

-- CreateIndex
CREATE INDEX "FinancialDocument_brandId_generatedAt_idx" ON "FinancialDocument"("brandId", "generatedAt");

-- CreateIndex
CREATE INDEX "CampaignMetric_campaignId_capturedAt_idx" ON "CampaignMetric"("campaignId", "capturedAt");

-- CreateIndex
CREATE INDEX "CampaignMetric_creatorProfileId_capturedAt_idx" ON "CampaignMetric"("creatorProfileId", "capturedAt");

-- CreateIndex
CREATE INDEX "CampaignMetric_deliverableId_capturedAt_idx" ON "CampaignMetric"("deliverableId", "capturedAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_creatorProfileId_eventType_createdAt_idx" ON "AnalyticsEvent"("creatorProfileId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_brandId_eventType_createdAt_idx" ON "AnalyticsEvent"("brandId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_campaignId_eventType_createdAt_idx" ON "AnalyticsEvent"("campaignId", "eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderWebhookEvent_eventKey_key" ON "ProviderWebhookEvent"("eventKey");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_provider_reference_idx" ON "ProviderWebhookEvent"("provider", "reference");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_processedAt_idx" ON "ProviderWebhookEvent"("processedAt");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_processingStartedAt_idx" ON "ProviderWebhookEvent"("processingStartedAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignParticipant" ADD CONSTRAINT "CampaignParticipant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignParticipant" ADD CONSTRAINT "CampaignParticipant_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_campaignParticipantId_fkey" FOREIGN KEY ("campaignParticipantId") REFERENCES "CampaignParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPortfolioItem" ADD CONSTRAINT "CreatorPortfolioItem_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPortfolioItem" ADD CONSTRAINT "CreatorPortfolioItem_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorRatePackage" ADD CONSTRAINT "CreatorRatePackage_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProspect" ADD CONSTRAINT "CreatorProspect_claimedProfileId_fkey" FOREIGN KEY ("claimedProfileId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandInterest" ADD CONSTRAINT "BrandInterest_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandInterest" ADD CONSTRAINT "BrandInterest_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "CreatorProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandInterest" ADD CONSTRAINT "BrandInterest_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandInterest" ADD CONSTRAINT "BrandInterest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMetricSnapshot" ADD CONSTRAINT "SocialMetricSnapshot_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorList" ADD CONSTRAINT "CreatorList_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorListItem" ADD CONSTRAINT "CreatorListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CreatorList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorListItem" ADD CONSTRAINT "CreatorListItem_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorListItem" ADD CONSTRAINT "CreatorListItem_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "CreatorProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorListBrand" ADD CONSTRAINT "CreatorListBrand_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CreatorList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorListBrand" ADD CONSTRAINT "CreatorListBrand_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brief" ADD CONSTRAINT "Brief_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefInvitation" ADD CONSTRAINT "BriefInvitation_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefInvitation" ADD CONSTRAINT "BriefInvitation_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_previousOfferId_fkey" FOREIGN KEY ("previousOfferId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandMembership" ADD CONSTRAINT "BrandMembership_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandMembership" ADD CONSTRAINT "BrandMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationSubscription" ADD CONSTRAINT "OrganisationSubscription_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganisationSubscription" ADD CONSTRAINT "OrganisationSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandWallet" ADD CONSTRAINT "BrandWallet_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPayoutAccount" ADD CONSTRAINT "CreatorPayoutAccount_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_campaignParticipantId_fkey" FOREIGN KEY ("campaignParticipantId") REFERENCES "CampaignParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PaymentObligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PaymentObligation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDocument" ADD CONSTRAINT "FinancialDocument_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDocument" ADD CONSTRAINT "FinancialDocument_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialDocument" ADD CONSTRAINT "FinancialDocument_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PaymentObligation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetric" ADD CONSTRAINT "CampaignMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetric" ADD CONSTRAINT "CampaignMetric_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetric" ADD CONSTRAINT "CampaignMetric_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetric" ADD CONSTRAINT "CampaignMetric_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
