-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "driverConfirmAskedAt" TIMESTAMP(3),
ADD COLUMN     "driverConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "driverDeclinedAt" TIMESTAMP(3),
ADD COLUMN     "reassignCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SmsLog" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT,
    "bookingId" TEXT,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsLog_dedupeKey_key" ON "SmsLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "SmsLog_bookingId_idx" ON "SmsLog"("bookingId");

-- CreateIndex
CREATE INDEX "SmsLog_kind_idx" ON "SmsLog"("kind");

-- CreateIndex
CREATE INDEX "SmsLog_createdAt_idx" ON "SmsLog"("createdAt");
