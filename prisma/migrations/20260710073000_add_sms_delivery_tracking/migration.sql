-- CreateTable
CREATE TABLE "SmsDelivery" (
    "id" TEXT NOT NULL,
    "twilioSid" TEXT,
    "recipient" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "bodyPreview" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "numSegments" INTEGER,
    "duplicateKey" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsDelivery_twilioSid_key" ON "SmsDelivery"("twilioSid");

-- CreateIndex
CREATE UNIQUE INDEX "SmsDelivery_duplicateKey_key" ON "SmsDelivery"("duplicateKey");

-- CreateIndex
CREATE INDEX "SmsDelivery_recipient_createdAt_idx" ON "SmsDelivery"("recipient", "createdAt");

-- CreateIndex
CREATE INDEX "SmsDelivery_status_createdAt_idx" ON "SmsDelivery"("status", "createdAt");