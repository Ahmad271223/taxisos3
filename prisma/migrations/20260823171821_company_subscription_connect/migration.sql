-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'P5',
ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" TEXT NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "subscriptionUntil" TIMESTAMP(3);
