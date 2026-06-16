-- CreateTable
CREATE TABLE "EventZone" (
    "id" TEXT NOT NULL,
    "eventHostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 300,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventZone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventZone_eventHostId_idx" ON "EventZone"("eventHostId");

-- AddForeignKey
ALTER TABLE "EventZone" ADD CONSTRAINT "EventZone_eventHostId_fkey" FOREIGN KEY ("eventHostId") REFERENCES "EventHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
