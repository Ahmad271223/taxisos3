-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "pScheinUntil" TEXT,
ADD COLUMN     "qualifications" TEXT,
ADD COLUMN     "wheelchairTrained" BOOLEAN NOT NULL DEFAULT false;
