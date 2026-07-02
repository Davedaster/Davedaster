ALTER TABLE "OrderStop" ADD COLUMN IF NOT EXISTS "trackingCode" TEXT;

DO $$
BEGIN
  ALTER TABLE "OrderStop"
    ADD CONSTRAINT "OrderStop_trackingCode_key"
    UNIQUE ("trackingCode");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
