-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "corporateCode" TEXT,
ADD COLUMN     "corporatePayer" TEXT;

-- CreateTable
CREATE TABLE "CorporateCode" (
    "id" TEXT NOT NULL,
    "eventHostId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "budgetCents" INTEGER,
    "maxRides" INTEGER,
    "perRideCents" INTEGER,
    "validUntil" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "usedRides" INTEGER NOT NULL DEFAULT 0,
    "usedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CorporateCode_code_key" ON "CorporateCode"("code");

-- CreateIndex
CREATE INDEX "CorporateCode_eventHostId_idx" ON "CorporateCode"("eventHostId");

-- AddForeignKey
ALTER TABLE "CorporateCode" ADD CONSTRAINT "CorporateCode_eventHostId_fkey" FOREIGN KEY ("eventHostId") REFERENCES "EventHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
