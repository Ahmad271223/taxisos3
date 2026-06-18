-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "eventHostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "eventDate" TEXT,
    "location" TEXT,
    "expectedGuests" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventGuest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "groupName" TEXT,
    "hotel" TEXT,
    "destAddress" TEXT,
    "isVip" BOOLEAN NOT NULL DEFAULT false,
    "requirements" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShuttleSlot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "time" TEXT NOT NULL,
    "vehicleClass" TEXT,
    "seats" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShuttleSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_eventHostId_idx" ON "Event"("eventHostId");

-- CreateIndex
CREATE INDEX "EventGuest_eventId_idx" ON "EventGuest"("eventId");

-- CreateIndex
CREATE INDEX "ShuttleSlot_eventId_idx" ON "ShuttleSlot"("eventId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_eventHostId_fkey" FOREIGN KEY ("eventHostId") REFERENCES "EventHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGuest" ADD CONSTRAINT "EventGuest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShuttleSlot" ADD CONSTRAINT "ShuttleSlot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
