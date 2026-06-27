-- Add customer signature proof-of-delivery fields to delivery groups.
ALTER TABLE "DeliveryGroup" ADD COLUMN "signatureImage" TEXT;
ALTER TABLE "DeliveryGroup" ADD COLUMN "signatureName" TEXT;
ALTER TABLE "DeliveryGroup" ADD COLUMN "signatureAcceptedAt" TIMESTAMP(3);
ALTER TABLE "DeliveryGroup" ADD COLUMN "signatureTermsAccepted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DeliveryGroup" ADD COLUMN "signatureTermsText" TEXT;
ALTER TABLE "DeliveryGroup" ADD COLUMN "signatureGpsLat" DOUBLE PRECISION;
ALTER TABLE "DeliveryGroup" ADD COLUMN "signatureGpsLng" DOUBLE PRECISION;
