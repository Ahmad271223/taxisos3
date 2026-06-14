-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "flightDelayMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "flightDirection" TEXT,
ADD COLUMN     "flightNumber" TEXT,
ADD COLUMN     "flightScheduledAt" TIMESTAMP(3),
ADD COLUMN     "flightStatus" TEXT,
ADD COLUMN     "terminal" TEXT;
