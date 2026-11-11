-- AlterTable
ALTER TABLE "TeamInvite" ADD COLUMN "brandId" TEXT;

-- Existing invites: pin to the organisation's first brand so accept still works.
UPDATE "TeamInvite" AS invite
SET "brandId" = (
  SELECT "id" FROM "Brand"
  WHERE "Brand"."organisationId" = invite."organisationId"
  ORDER BY "Brand"."createdAt" ASC
  LIMIT 1
)
WHERE invite."brandId" IS NULL;

DELETE FROM "TeamInvite" WHERE "brandId" IS NULL;

ALTER TABLE "TeamInvite" ALTER COLUMN "brandId" SET NOT NULL;

ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TeamInvite_brandId_idx" ON "TeamInvite"("brandId");
