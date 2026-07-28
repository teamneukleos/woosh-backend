-- YouTube channel titles are not globally unique. Identify accounts by the
-- platform user id and allow each creator one connection per platform.
DROP INDEX IF EXISTS "creator_social_accounts_platform_handle_key";

CREATE UNIQUE INDEX "creator_social_accounts_creator_id_platform_key"
ON "creator_social_accounts"("creator_id", "platform");

CREATE UNIQUE INDEX "creator_social_accounts_platform_platform_user_id_key"
ON "creator_social_accounts"("platform", "platform_user_id");
