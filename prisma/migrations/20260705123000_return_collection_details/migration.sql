-- Add fields needed for return collection planning pins, driver proof, SMS proof links and archive searches.
ALTER TABLE "ReturnTicket"
  ADD COLUMN "originalOrderId" TEXT,
  ADD COLUMN "originalOrderCreatedAt" TIMESTAMP(3),
  ADD COLUMN "returnRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "collectionProofToken" TEXT,
  ADD COLUMN "collectionCompletedSmsSentAt" TIMESTAMP(3);

ALTER TABLE "ReturnTicketLine"
  ADD COLUMN "isExtraItem" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "ReturnTicket_collectionProofToken_key" ON "ReturnTicket"("collectionProofToken");
