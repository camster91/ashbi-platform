ALTER TABLE "projects"
ADD COLUMN "sourceContractId" TEXT;

CREATE UNIQUE INDEX "projects_sourceContractId_key"
ON "projects"("sourceContractId");

ALTER TABLE "projects"
ADD CONSTRAINT "projects_sourceContractId_fkey"
FOREIGN KEY ("sourceContractId") REFERENCES "contracts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
