-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "companions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "institutionId" TEXT,
ADD COLUMN     "insuranceName" TEXT,
ADD COLUMN     "insuranceNumber" TEXT,
ADD COLUMN     "medicalEquipment" TEXT,
ADD COLUMN     "mobility" TEXT,
ADD COLUMN     "patientBirthDate" TEXT,
ADD COLUMN     "patientName" TEXT,
ADD COLUMN     "payerType" TEXT,
ADD COLUMN     "requiresRamp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresStretcher" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "hasRamp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasStretcher" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RecurringRide" ADD COLUMN     "companions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "institutionId" TEXT,
ADD COLUMN     "insuranceName" TEXT,
ADD COLUMN     "insuranceNumber" TEXT,
ADD COLUMN     "medicalEquipment" TEXT,
ADD COLUMN     "mobility" TEXT,
ADD COLUMN     "patientBirthDate" TEXT,
ADD COLUMN     "patientName" TEXT,
ADD COLUMN     "payerType" TEXT,
ADD COLUMN     "requiresRamp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresStretcher" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'KLINIK',
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionPatient" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birthDate" TEXT,
    "phone" TEXT,
    "defaultPickupAddress" TEXT,
    "defaultPickupLat" DOUBLE PRECISION,
    "defaultPickupLng" DOUBLE PRECISION,
    "mobility" TEXT,
    "medicalEquipment" TEXT,
    "payerType" TEXT,
    "insuranceName" TEXT,
    "insuranceNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionPatient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalDocument" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "dataBase64" TEXT NOT NULL,
    "customerId" TEXT,
    "bookingId" TEXT,
    "recurringId" TEXT,
    "institutionId" TEXT,
    "uploadedByType" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Institution_email_key" ON "Institution"("email");

-- CreateIndex
CREATE INDEX "InstitutionPatient_institutionId_idx" ON "InstitutionPatient"("institutionId");

-- CreateIndex
CREATE INDEX "MedicalDocument_reviewStatus_idx" ON "MedicalDocument"("reviewStatus");

-- CreateIndex
CREATE INDEX "MedicalDocument_bookingId_idx" ON "MedicalDocument"("bookingId");

-- CreateIndex
CREATE INDEX "MedicalDocument_customerId_idx" ON "MedicalDocument"("customerId");

-- CreateIndex
CREATE INDEX "MedicalDocument_institutionId_idx" ON "MedicalDocument"("institutionId");

-- CreateIndex
CREATE INDEX "AccessLog_entity_entityId_idx" ON "AccessLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AccessLog_actorType_actorId_idx" ON "AccessLog"("actorType", "actorId");

-- CreateIndex
CREATE INDEX "AccessLog_at_idx" ON "AccessLog"("at");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRide" ADD CONSTRAINT "RecurringRide_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionPatient" ADD CONSTRAINT "InstitutionPatient_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocument" ADD CONSTRAINT "MedicalDocument_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocument" ADD CONSTRAINT "MedicalDocument_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocument" ADD CONSTRAINT "MedicalDocument_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringRide"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalDocument" ADD CONSTRAINT "MedicalDocument_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
