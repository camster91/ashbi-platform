-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "startDate" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "dependsOnId" TEXT;

-- CreateIndex
CREATE INDEX "tasks_dependsOnId_idx" ON "tasks"("dependsOnId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
