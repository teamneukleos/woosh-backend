-- CreateEnum
CREATE TYPE "IntendedRole" AS ENUM ('CREATOR', 'BRAND', 'AGENCY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "intended_role" "IntendedRole";
