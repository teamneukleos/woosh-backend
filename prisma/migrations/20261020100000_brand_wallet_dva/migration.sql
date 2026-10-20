-- AlterTable
ALTER TABLE "BrandWallet" ADD COLUMN "paystackCustomerCode" TEXT;
ALTER TABLE "BrandWallet" ADD COLUMN "dvaAccountName" TEXT;
ALTER TABLE "BrandWallet" ADD COLUMN "dvaBankName" TEXT;
ALTER TABLE "BrandWallet" ADD COLUMN "encryptedDvaAccountNumber" TEXT;
ALTER TABLE "BrandWallet" ADD COLUMN "dvaAccountNumberLast4" TEXT;
ALTER TABLE "BrandWallet" ADD COLUMN "dvaAssignedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "BrandWallet_paystackCustomerCode_key" ON "BrandWallet"("paystackCustomerCode");
