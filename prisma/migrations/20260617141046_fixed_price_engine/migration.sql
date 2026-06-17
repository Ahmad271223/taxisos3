-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "priceIsFixed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FixedPriceRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromLabel" TEXT,
    "fromLat" DOUBLE PRECISION NOT NULL,
    "fromLng" DOUBLE PRECISION NOT NULL,
    "fromRadius" INTEGER NOT NULL DEFAULT 1500,
    "toLabel" TEXT,
    "toLat" DOUBLE PRECISION NOT NULL,
    "toLng" DOUBLE PRECISION NOT NULL,
    "toRadius" INTEGER NOT NULL DEFAULT 1500,
    "price" DOUBLE PRECISION NOT NULL,
    "bidirectional" BOOLEAN NOT NULL DEFAULT true,
    "vehicleClass" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedPriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FixedPriceRule_companyId_idx" ON "FixedPriceRule"("companyId");

-- AddForeignKey
ALTER TABLE "FixedPriceRule" ADD CONSTRAINT "FixedPriceRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
