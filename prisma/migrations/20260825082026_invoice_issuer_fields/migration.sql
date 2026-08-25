-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "driverNameSnap" TEXT,
ADD COLUMN     "driverPlateSnap" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bic" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "vatId" TEXT;
