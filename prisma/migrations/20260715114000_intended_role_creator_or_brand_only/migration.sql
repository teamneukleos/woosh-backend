UPDATE "users" SET "intended_role" = 'BRAND' WHERE "intended_role" = 'AGENCY';
CREATE TYPE "IntendedRole_new" AS ENUM ('CREATOR', 'BRAND');
ALTER TABLE "users" ALTER COLUMN "intended_role" TYPE "IntendedRole_new" USING ("intended_role"::text::"IntendedRole_new");
DROP TYPE "IntendedRole";
ALTER TYPE "IntendedRole_new" RENAME TO "IntendedRole";