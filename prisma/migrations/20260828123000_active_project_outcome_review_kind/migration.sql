ALTER TABLE "migration_review_packets"
DROP CONSTRAINT IF EXISTS "migration_review_packets_kind_check";

ALTER TABLE "migration_review_packets"
ADD CONSTRAINT "migration_review_packets_kind_check" CHECK ("kind" IN (
  'NOTION_BONSAI_PROJECT_LINK',
  'NOTION_BONSAI_TASK_DISPOSITION',
  'NOTION_BONSAI_PROJECT_DISPOSITION',
  'BONSAI_FINANCIAL_EXCEPTION',
  'BONSAI_ACTIVE_PROJECT_OUTCOME'
));
