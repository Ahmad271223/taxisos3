-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "vehicleClass" TEXT NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "vehicleClass" TEXT NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "VehicleClassPricing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "classKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "flatSurcharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleClassPricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleClassPricing_companyId_idx" ON "VehicleClassPricing"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleClassPricing_companyId_classKey_key" ON "VehicleClassPricing"("companyId", "classKey");

-- AddForeignKey
ALTER TABLE "VehicleClassPricing" ADD CONSTRAINT "VehicleClassPricing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
