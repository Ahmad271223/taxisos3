-- AlterTable
ALTER TABLE "AccessLog" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "AccessLog_companyId_at_idx" ON "AccessLog"("companyId", "at");
