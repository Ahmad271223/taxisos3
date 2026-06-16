-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "meetGreet" TEXT,
ADD COLUMN     "meetGreetFee" DOUBLE PRECISION,
ADD COLUMN     "waitFee" DOUBLE PRECISION,
ADD COLUMN     "waitMinutes" INTEGER;
