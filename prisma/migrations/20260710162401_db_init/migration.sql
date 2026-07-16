-- Required for @db.Citext columns (must live in the Prisma schema)
CREATE SCHEMA IF NOT EXISTS "kreate";
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA "kreate";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "BrandIndustry" AS ENUM ('FMCG', 'FINTECH', 'FASHION', 'TELCO', 'BEAUTY', 'FOOD', 'OTHER');

-- CreateEnum
CREATE TYPE "BrandServiceMode" AS ENUM ('MANAGED', 'SELF_SERVE');

-- CreateEnum
CREATE TYPE "BrandStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'CHURNED');

-- CreateEnum
CREATE TYPE "BrandMemberRole" AS ENUM ('OWNER', 'MANAGER', 'VIEWER', 'AGENCY');

-- CreateEnum
CREATE TYPE "CreatorTier" AS ENUM ('NANO', 'MICRO', 'MID');

-- CreateEnum
CREATE TYPE "ContentLanguage" AS ENUM ('EN', 'PIDGIN', 'YO', 'IG', 'HA');

-- CreateEnum
CREATE TYPE "CreatorMembership" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'BANNED');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'TIKTOK', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "SyncSource" AS ENUM ('API', 'MANUAL_SCREENSHOT');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'FUNDED', 'RECRUITING', 'ACTIVE', 'IN_REVIEW', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACCEPTED', 'CONTRACTED', 'DRAFTING', 'SUBMITTED', 'REVISION', 'APPROVED', 'PUBLISHED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'VOIDED');

-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REVISION_REQUESTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED_BRAND', 'RESOLVED_CREATOR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK', 'FLUTTERWAVE');

-- CreateEnum
CREATE TYPE "BrandPaymentType" AS ENUM ('ESCROW_FUND', 'TOP_UP', 'MANAGED_FEE');

-- CreateEnum
CREATE TYPE "BrandPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "EscrowEntryType" AS ENUM ('CREDIT', 'HOLD', 'RELEASE', 'REFUND', 'COMMISSION');

-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('CAMPAIGN_CREDIT', 'BONUS', 'WITHDRAWAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('BRAND_INVOICE', 'CREATOR_RECEIPT');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('API', 'MANUAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'READ');

-- CreateEnum
CREATE TYPE "AiDisclosureMode" AS ENUM ('ALWAYS_DISCLOSED', 'BRAND_DISCRETION');

-- CreateEnum
CREATE TYPE "AiContentStatus" AS ENUM ('GENERATED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" VARCHAR(20),
    "password_hash" TEXT,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "avatar_url" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "access_token_enc" BYTEA NOT NULL,
    "refresh_token_enc" BYTEA,
    "scopes" TEXT[],
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "industry" "BrandIndustry" NOT NULL,
    "logo_url" TEXT,
    "website" TEXT,
    "country_code" CHAR(2) NOT NULL DEFAULT 'NG',
    "billing_email" CITEXT NOT NULL,
    "service_mode" "BrandServiceMode" NOT NULL DEFAULT 'MANAGED',
    "status" "BrandStatus" NOT NULL DEFAULT 'PROSPECT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_members" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "BrandMemberRole" NOT NULL DEFAULT 'MANAGER',
    "invited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),

    CONSTRAINT "brand_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creators" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(150) NOT NULL,
    "bio" TEXT,
    "location_state" VARCHAR(80) NOT NULL,
    "location_city" VARCHAR(80),
    "tier" "CreatorTier" NOT NULL DEFAULT 'NANO',
    "primary_language" "ContentLanguage" NOT NULL DEFAULT 'EN',
    "authenticity_score" DECIMAL(5,2),
    "authenticity_scored_at" TIMESTAMPTZ(6),
    "rate_min_kobo" BIGINT,
    "rate_max_kobo" BIGINT,
    "membership" "CreatorMembership" NOT NULL DEFAULT 'FREE',
    "membership_expires_at" TIMESTAMPTZ(6),
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "referral_code" VARCHAR(20) NOT NULL,
    "referred_by_id" UUID,
    "priority_brief_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "creators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_social_accounts" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "handle" VARCHAR(100) NOT NULL,
    "platform_user_id" TEXT,
    "profile_url" TEXT,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "engagement_rate" DECIMAL(6,4),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMPTZ(6),
    "sync_source" "SyncSource" NOT NULL DEFAULT 'MANUAL_SCREENSHOT',
    "oauth_account_id" UUID,

    CONSTRAINT "creator_social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "niches" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "niches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_niches" (
    "creator_id" UUID NOT NULL,
    "niche_id" UUID NOT NULL,

    CONSTRAINT "creator_niches_pkey" PRIMARY KEY ("creator_id","niche_id")
);

-- CreateTable
CREATE TABLE "creator_languages" (
    "creator_id" UUID NOT NULL,
    "language" "ContentLanguage" NOT NULL,

    CONSTRAINT "creator_languages_pkey" PRIMARY KEY ("creator_id","language")
);

-- CreateTable
CREATE TABLE "authenticity_score_runs" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "factors" JSONB NOT NULL,
    "model_version" VARCHAR(40) NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authenticity_score_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlists" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shortlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlist_creators" (
    "shortlist_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "notes" TEXT,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shortlist_creators_pkey" PRIMARY KEY ("shortlist_id","creator_id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "product_name" VARCHAR(200) NOT NULL,
    "product_description" TEXT,
    "deliverables_spec" JSONB NOT NULL,
    "dos" TEXT,
    "donts" TEXT,
    "deadline_at" TIMESTAMPTZ(6) NOT NULL,
    "compensation_per_creator_kobo" BIGINT NOT NULL,
    "bonus_rules" JSONB,
    "bonus_amount_kobo" BIGINT,
    "slots_total" INTEGER NOT NULL,
    "slots_filled" INTEGER NOT NULL DEFAULT 0,
    "commission_bps" INTEGER NOT NULL DEFAULT 1500,
    "managed_uplift_bps" INTEGER,
    "total_budget_kobo" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "published_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_invites" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'INVITED',
    "message" TEXT,
    "invited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respond_by_at" TIMESTAMPTZ(6) NOT NULL,
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "campaign_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_assignments" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACCEPTED',
    "agreed_fee_kobo" BIGINT NOT NULL,
    "tracking_code" VARCHAR(40) NOT NULL,
    "utm_url" TEXT,
    "discount_code" VARCHAR(40),
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "campaign_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "terms_snapshot" JSONB NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "pdf_url" TEXT,
    "signed_at" TIMESTAMPTZ(6),
    "signer_ip" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverables" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "round" SMALLINT NOT NULL,
    "status" "DeliverableStatus" NOT NULL DEFAULT 'DRAFT',
    "platform" "SocialPlatform" NOT NULL,
    "media_urls" JSONB NOT NULL,
    "caption" TEXT,
    "post_url" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by_user_id" UUID,
    "revision_notes" TEXT,

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "opened_by_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution_notes" TEXT,
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_payments" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'NGN',
    "type" "BrandPaymentType" NOT NULL,
    "status" "BrandPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "raw_webhook" JSONB,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrow_ledger" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "entry_type" "EscrowEntryType" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "balance_after_kobo" BIGINT NOT NULL,
    "assignment_id" UUID,
    "payout_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_bank_accounts" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "bank_code" VARCHAR(10) NOT NULL,
    "bank_name" VARCHAR(120) NOT NULL,
    "account_number_enc" BYTEA NOT NULL,
    "account_name" VARCHAR(150) NOT NULL,
    "paystack_recipient_code" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_wallets" (
    "creator_id" UUID NOT NULL,
    "available_kobo" BIGINT NOT NULL DEFAULT 0,
    "pending_kobo" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "creator_wallets_pkey" PRIMARY KEY ("creator_id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "type" "WalletTxType" NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "balance_after_kobo" BIGINT NOT NULL,
    "reference" TEXT NOT NULL,
    "payout_id" UUID,
    "assignment_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "assignment_id" UUID,
    "bank_account_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_transfer_code" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "failure_reason" TEXT,
    "due_by" DATE NOT NULL,
    "initiated_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "brand_id" UUID,
    "creator_id" UUID,
    "campaign_id" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "subtotal_kobo" BIGINT NOT NULL,
    "tax_kobo" BIGINT NOT NULL DEFAULT 0,
    "total_kobo" BIGINT NOT NULL,
    "pdf_url" TEXT,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_snapshots" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "deliverable_id" UUID,
    "platform" "SocialPlatform" NOT NULL,
    "external_post_id" TEXT,
    "reach" BIGINT,
    "impressions" BIGINT,
    "likes" BIGINT,
    "comments" BIGINT,
    "shares" BIGINT,
    "saves" BIGINT,
    "views" BIGINT,
    "clicks" BIGINT,
    "conversions" BIGINT,
    "source" "MetricSource" NOT NULL DEFAULT 'API',
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_reports" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "metrics" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_url" TEXT,
    "xlsx_url" TEXT,

    CONSTRAINT "campaign_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_personas" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "niche" VARCHAR(120) NOT NULL,
    "voice_spec" JSONB NOT NULL,
    "visual_style" JSONB NOT NULL,
    "disclosure_mode" "AiDisclosureMode" NOT NULL DEFAULT 'ALWAYS_DISCLOSED',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "monthly_retainer_kobo" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_persona_content" (
    "id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "campaign_id" UUID,
    "draft_payload" JSONB NOT NULL,
    "status" "AiContentStatus" NOT NULL DEFAULT 'GENERATED',
    "reviewed_by_user_id" UUID,
    "is_ai_disclosed" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_persona_content_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_provider_account_id_key" ON "oauth_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_industry_idx" ON "brands"("industry");

-- CreateIndex
CREATE INDEX "brands_status_idx" ON "brands"("status");

-- CreateIndex
CREATE INDEX "brand_members_user_id_idx" ON "brand_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_members_brand_id_user_id_key" ON "brand_members"("brand_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "creators_user_id_key" ON "creators"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "creators_referral_code_key" ON "creators"("referral_code");

-- CreateIndex
CREATE INDEX "creators_verification_status_authenticity_score_idx" ON "creators"("verification_status", "authenticity_score");

-- CreateIndex
CREATE INDEX "creators_location_state_idx" ON "creators"("location_state");

-- CreateIndex
CREATE INDEX "creators_tier_idx" ON "creators"("tier");

-- CreateIndex
CREATE INDEX "creator_social_accounts_creator_id_idx" ON "creator_social_accounts"("creator_id");

-- CreateIndex
CREATE INDEX "creator_social_accounts_follower_count_idx" ON "creator_social_accounts"("follower_count");

-- CreateIndex
CREATE UNIQUE INDEX "creator_social_accounts_platform_handle_key" ON "creator_social_accounts"("platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "niches_slug_key" ON "niches"("slug");

-- CreateIndex
CREATE INDEX "authenticity_score_runs_creator_id_computed_at_idx" ON "authenticity_score_runs"("creator_id", "computed_at" DESC);

-- CreateIndex
CREATE INDEX "shortlists_brand_id_idx" ON "shortlists"("brand_id");

-- CreateIndex
CREATE INDEX "campaigns_brand_id_status_idx" ON "campaigns"("brand_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_deadline_at_idx" ON "campaigns"("deadline_at");

-- CreateIndex
CREATE INDEX "campaigns_status_published_at_idx" ON "campaigns"("status", "published_at");

-- CreateIndex
CREATE INDEX "campaign_invites_creator_id_status_idx" ON "campaign_invites"("creator_id", "status");

-- CreateIndex
CREATE INDEX "campaign_invites_respond_by_at_idx" ON "campaign_invites"("respond_by_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_invites_campaign_id_creator_id_key" ON "campaign_invites"("campaign_id", "creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_assignments_invite_id_key" ON "campaign_assignments"("invite_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_assignments_tracking_code_key" ON "campaign_assignments"("tracking_code");

-- CreateIndex
CREATE INDEX "campaign_assignments_status_idx" ON "campaign_assignments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_assignments_campaign_id_creator_id_key" ON "campaign_assignments"("campaign_id", "creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_assignment_id_key" ON "contracts"("assignment_id");

-- CreateIndex
CREATE INDEX "deliverables_assignment_id_round_idx" ON "deliverables"("assignment_id", "round");

-- CreateIndex
CREATE INDEX "deliverables_status_idx" ON "deliverables"("status");

-- CreateIndex
CREATE INDEX "disputes_assignment_id_idx" ON "disputes"("assignment_id");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "brand_payments_provider_reference_key" ON "brand_payments"("provider_reference");

-- CreateIndex
CREATE INDEX "brand_payments_campaign_id_idx" ON "brand_payments"("campaign_id");

-- CreateIndex
CREATE INDEX "brand_payments_status_idx" ON "brand_payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "escrow_ledger_idempotency_key_key" ON "escrow_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "escrow_ledger_campaign_id_created_at_idx" ON "escrow_ledger"("campaign_id", "created_at");

-- CreateIndex
CREATE INDEX "escrow_ledger_assignment_id_idx" ON "escrow_ledger"("assignment_id");

-- CreateIndex
CREATE INDEX "creator_bank_accounts_creator_id_idx" ON "creator_bank_accounts"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_reference_key" ON "wallet_transactions"("reference");

-- CreateIndex
CREATE INDEX "wallet_transactions_creator_id_created_at_idx" ON "wallet_transactions"("creator_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_status_due_by_idx" ON "payouts"("status", "due_by");

-- CreateIndex
CREATE INDEX "payouts_creator_id_idx" ON "payouts"("creator_id");

-- CreateIndex
CREATE INDEX "payouts_assignment_id_idx" ON "payouts"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_campaign_id_idx" ON "invoices"("campaign_id");

-- CreateIndex
CREATE INDEX "engagement_snapshots_assignment_id_captured_at_idx" ON "engagement_snapshots"("assignment_id", "captured_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_reports_campaign_id_key" ON "campaign_reports"("campaign_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_status_idx" ON "notifications"("user_id", "status");

-- CreateIndex
CREATE INDEX "notifications_channel_status_idx" ON "notifications"("channel", "status");

-- CreateIndex
CREATE INDEX "ai_personas_brand_id_idx" ON "ai_personas"("brand_id");

-- CreateIndex
CREATE INDEX "ai_persona_content_persona_id_status_idx" ON "ai_persona_content"("persona_id", "status");

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_members" ADD CONSTRAINT "brand_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creators" ADD CONSTRAINT "creators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creators" ADD CONSTRAINT "creators_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "creators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_social_accounts" ADD CONSTRAINT "creator_social_accounts_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_social_accounts" ADD CONSTRAINT "creator_social_accounts_oauth_account_id_fkey" FOREIGN KEY ("oauth_account_id") REFERENCES "oauth_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_niches" ADD CONSTRAINT "creator_niches_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_niches" ADD CONSTRAINT "creator_niches_niche_id_fkey" FOREIGN KEY ("niche_id") REFERENCES "niches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_languages" ADD CONSTRAINT "creator_languages_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authenticity_score_runs" ADD CONSTRAINT "authenticity_score_runs_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlist_creators" ADD CONSTRAINT "shortlist_creators_shortlist_id_fkey" FOREIGN KEY ("shortlist_id") REFERENCES "shortlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlist_creators" ADD CONSTRAINT "shortlist_creators_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_assignments" ADD CONSTRAINT "campaign_assignments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_assignments" ADD CONSTRAINT "campaign_assignments_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_assignments" ADD CONSTRAINT "campaign_assignments_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "campaign_invites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "campaign_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "campaign_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "campaign_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_user_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_payments" ADD CONSTRAINT "brand_payments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_payments" ADD CONSTRAINT "brand_payments_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrow_ledger" ADD CONSTRAINT "escrow_ledger_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrow_ledger" ADD CONSTRAINT "escrow_ledger_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "campaign_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrow_ledger" ADD CONSTRAINT "escrow_ledger_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_bank_accounts" ADD CONSTRAINT "creator_bank_accounts_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_wallets" ADD CONSTRAINT "creator_wallets_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "campaign_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "campaign_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "creator_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_snapshots" ADD CONSTRAINT "engagement_snapshots_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "campaign_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_snapshots" ADD CONSTRAINT "engagement_snapshots_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "deliverables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_reports" ADD CONSTRAINT "campaign_reports_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_personas" ADD CONSTRAINT "ai_personas_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_persona_content" ADD CONSTRAINT "ai_persona_content_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "ai_personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_persona_content" ADD CONSTRAINT "ai_persona_content_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_persona_content" ADD CONSTRAINT "ai_persona_content_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
