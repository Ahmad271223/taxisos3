-- AlterTable: hochentropischer Tracking-Token (UUID v4) für Gast-Links.
-- Nullable -> bestehende Buchungen behalten NULL (Tracking-Links fallen auf die
-- ID zurück). Neue Buchungen erhalten den Token über das Prisma-@default(uuid()).
ALTER TABLE "Booking" ADD COLUMN "trackingToken" TEXT;

-- CreateIndex: Unique (mehrere NULLs sind in PostgreSQL distinkt -> kein Konflikt).
CREATE UNIQUE INDEX "Booking_trackingToken_key" ON "Booking"("trackingToken");
