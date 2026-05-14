-- CreateTable
CREATE TABLE "ProofPhoto" (
    "id" TEXT NOT NULL,
    "deliveryGroupId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProofPhoto_deliveryGroupId_idx" ON "ProofPhoto"("deliveryGroupId");

-- AddForeignKey
ALTER TABLE "ProofPhoto" ADD CONSTRAINT "ProofPhoto_deliveryGroupId_fkey" FOREIGN KEY ("deliveryGroupId") REFERENCES "DeliveryGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
