-- AlterTable
ALTER TABLE "BriefInvitation" ALTER COLUMN "creatorProfileId" DROP NOT NULL;
ALTER TABLE "BriefInvitation" ADD COLUMN "prospectId" TEXT;

-- AddForeignKey
ALTER TABLE "BriefInvitation" ADD CONSTRAINT "BriefInvitation_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "CreatorProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "BriefInvitation_prospectId_idx" ON "BriefInvitation"("prospectId");
