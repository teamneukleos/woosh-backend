-- AlterTable
ALTER TABLE "CreatorProspect" ADD COLUMN "graphStatus" TEXT;
ALTER TABLE "CreatorProspect" ADD COLUMN "graphFetchedAt" TIMESTAMP(3);
ALTER TABLE "CreatorProspect" ADD COLUMN "graphPayload" JSONB;

-- CreateTable
CREATE TABLE "JobCursor" (
    "id" TEXT NOT NULL,
    "lineOffset" INTEGER NOT NULL DEFAULT 0,
    "lastHandle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobCursor_pkey" PRIMARY KEY ("id")
);
