-- CreateTable
CREATE TABLE "HotelGuest" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "roomNumber" TEXT,
    "language" TEXT,
    "preferredVehicleClass" TEXT,
    "defaultDestAddress" TEXT,
    "defaultDestLat" DOUBLE PRECISION,
    "defaultDestLng" DOUBLE PRECISION,
    "isVip" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HotelGuest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HotelGuest_hotelId_idx" ON "HotelGuest"("hotelId");

-- AddForeignKey
ALTER TABLE "HotelGuest" ADD CONSTRAINT "HotelGuest_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
