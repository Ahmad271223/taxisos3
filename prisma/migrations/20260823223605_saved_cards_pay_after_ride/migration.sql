-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cardId" TEXT,
ADD COLUMN     "paymentAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentError" TEXT,
ADD COLUMN     "tipPromptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" TEXT;

-- CreateTable
CREATE TABLE "CustomerCard" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER NOT NULL,
    "expYear" INTEGER NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCard_stripePaymentMethodId_key" ON "CustomerCard"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "CustomerCard_customerId_idx" ON "CustomerCard"("customerId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CustomerCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCard" ADD CONSTRAINT "CustomerCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
