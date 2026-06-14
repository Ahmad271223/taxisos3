-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "medicalType" TEXT,
ADD COLUMN     "recurringId" TEXT;

-- CreateTable
CREATE TABLE "RecurringRide" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "destAddress" TEXT NOT NULL,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "vehicleClass" TEXT NOT NULL DEFAULT 'WHEELCHAIR',
    "medicalType" TEXT,
    "daysOfWeek" TEXT NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "returnTrip" BOOLEAN NOT NULL DEFAULT false,
    "returnTimeOfDay" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringRide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringRide_customerId_idx" ON "RecurringRide"("customerId");

-- CreateIndex
CREATE INDEX "RecurringRide_active_idx" ON "RecurringRide"("active");

-- CreateIndex
CREATE INDEX "Booking_recurringId_idx" ON "Booking"("recurringId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringRide"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRide" ADD CONSTRAINT "RecurringRide_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
