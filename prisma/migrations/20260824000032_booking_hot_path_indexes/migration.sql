-- CreateIndex
CREATE INDEX "Booking_driverId_status_trackingStatus_idx" ON "Booking"("driverId", "status", "trackingStatus");

-- CreateIndex
CREATE INDEX "Booking_isScheduled_status_dispatchMode_scheduledAt_idx" ON "Booking"("isScheduled", "status", "dispatchMode", "scheduledAt");

-- CreateIndex
CREATE INDEX "Booking_paymentMethod_paymentStatus_tipPromptedAt_idx" ON "Booking"("paymentMethod", "paymentStatus", "tipPromptedAt");
