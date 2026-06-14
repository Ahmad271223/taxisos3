-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "isSos" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SosAlert" ADD COLUMN     "rescueBookingId" TEXT;
