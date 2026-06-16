-- CreateTable
CREATE TABLE "RideSignature" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "signedName" TEXT,
    "dataBase64" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RideSignature_bookingId_key" ON "RideSignature"("bookingId");

-- AddForeignKey
ALTER TABLE "RideSignature" ADD CONSTRAINT "RideSignature_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
