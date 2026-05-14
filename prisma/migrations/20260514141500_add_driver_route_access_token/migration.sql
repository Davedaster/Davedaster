-- AlterTable
ALTER TABLE "Route" ADD COLUMN "driverAccessToken" TEXT;
ALTER TABLE "Route" ADD COLUMN "driverAccessTokenCreatedAt" TIMESTAMP(3);
ALTER TABLE "Route" ADD COLUMN "driverRouteLinkSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Route_driverAccessToken_key" ON "Route"("driverAccessToken");
