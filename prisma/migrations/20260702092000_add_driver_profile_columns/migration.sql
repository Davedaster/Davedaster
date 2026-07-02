-- Keep this migration defensive because the live app may already have some of these columns.
-- The driver profile UI uses these fields, and Railway runs prisma migrate deploy during setup.

CREATE TABLE IF NOT EXISTS "Driver" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "photoUrl" TEXT,
  "phoneNumber" TEXT,
  "email" TEXT,
  "vehicleName" TEXT,
  "vehicleRegistration" TEXT,
  "vehicleType" TEXT,
  "fuelCardNumber" TEXT,
  "fuelCardProvider" TEXT,
  "startAddress" TEXT,
  "endAddress" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "vehicleName" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "vehicleRegistration" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "vehicleType" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "fuelCardNumber" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "fuelCardProvider" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "startAddress" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "endAddress" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Driver" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Driver" ALTER COLUMN "isActive" SET DEFAULT true;
ALTER TABLE "Driver" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Driver" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS "driverId" TEXT;

DO $$
BEGIN
  ALTER TABLE "Route"
    ADD CONSTRAINT "Route_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
