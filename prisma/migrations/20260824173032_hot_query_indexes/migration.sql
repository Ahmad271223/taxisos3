-- CreateIndex
CREATE INDEX "Booking_hotelId_createdAt_idx" ON "Booking"("hotelId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_companyId_status_completedAt_idx" ON "Booking"("companyId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "Booking_companyId_status_cancelledAt_idx" ON "Booking"("companyId", "status", "cancelledAt");

-- CreateIndex
CREATE INDEX "Booking_customerId_createdAt_idx" ON "Booking"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_status_isScheduled_trackingStatus_createdAt_idx" ON "Booking"("status", "isScheduled", "trackingStatus", "createdAt");
