-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "institutionPatientId" TEXT;

-- AlterTable
ALTER TABLE "InstitutionPatient" ADD COLUMN     "address" TEXT,
ADD COLUMN     "befreiungUntil" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "kostentraegerNummer" TEXT;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_institutionPatientId_fkey" FOREIGN KEY ("institutionPatientId") REFERENCES "InstitutionPatient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
