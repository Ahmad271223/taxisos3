-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "isVip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferredCompanyIds" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "preferredCompanyIds" TEXT NOT NULL DEFAULT '';
