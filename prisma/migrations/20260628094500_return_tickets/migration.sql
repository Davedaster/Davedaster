CREATE TABLE "ReturnTicket" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "routeId" TEXT,
  "stopId" TEXT,
  "orderNumber" TEXT,
  "customerName" TEXT NOT NULL,
  "customerEmail" TEXT,
  "customerPhone" TEXT,
  "address" TEXT NOT NULL,
  "postcode" TEXT,
  "notes" TEXT,
  "searchText" TEXT NOT NULL,
  "collectionPhotoUrl" TEXT,
  "customerSignature" TEXT,
  "driverNote" TEXT,
  "collectedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReturnTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReturnTicketLine" (
  "id" TEXT NOT NULL,
  "returnTicketId" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "quantityExpected" INTEGER NOT NULL DEFAULT 1,
  "quantityCollected" INTEGER NOT NULL DEFAULT 0,
  "conditionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReturnTicketLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReturnTicket_reference_key" ON "ReturnTicket"("reference");
CREATE INDEX "ReturnTicket_searchText_idx" ON "ReturnTicket"("searchText");
CREATE INDEX "ReturnTicket_status_idx" ON "ReturnTicket"("status");
CREATE INDEX "ReturnTicket_routeId_idx" ON "ReturnTicket"("routeId");
CREATE INDEX "ReturnTicket_stopId_idx" ON "ReturnTicket"("stopId");

ALTER TABLE "ReturnTicket" ADD CONSTRAINT "ReturnTicket_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReturnTicket" ADD CONSTRAINT "ReturnTicket_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReturnTicketLine" ADD CONSTRAINT "ReturnTicketLine_returnTicketId_fkey" FOREIGN KEY ("returnTicketId") REFERENCES "ReturnTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
