-- Add viewToken to projects
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "viewToken" TEXT;

-- Generate unique tokens for existing projects
UPDATE "projects" SET "viewToken" = gen_random_uuid()::text WHERE "viewToken" IS NULL;

-- Make viewToken unique and not null
ALTER TABLE "projects" ALTER COLUMN "viewToken" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "projects_viewToken_key" ON "projects"("viewToken");

-- Migrate project statuses from old enum to new Notion-style
UPDATE "projects" SET "status" = 'STARTING_UP' WHERE "status" = 'ACTIVE';
UPDATE "projects" SET "status" = 'LAUNCHED' WHERE "status" = 'COMPLETED';
-- ON_HOLD and CANCELLED stay as-is

-- Create credentials table
CREATE TABLE IF NOT EXISTS "credentials" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "username" TEXT,
    "password" TEXT NOT NULL,
    "url" TEXT,
    "notes" TEXT,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "clientId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- Create task_templates table
CREATE TABLE IF NOT EXISTS "task_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "tasks" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys for credentials
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default task templates
INSERT INTO "task_templates" ("id", "name", "phase", "tasks", "updatedAt") VALUES
  ('tmpl_starting_up', 'Starting Up', 'STARTING_UP', '[{"title":"Kickoff call","description":"Schedule and complete kickoff call with client","assignee_role":"ADMIN"},{"title":"Brand brief","description":"Collect brand guidelines, assets, and preferences","assignee_role":"ADMIN"},{"title":"Domain setup","description":"Register or transfer domain, configure DNS","assignee_role":"TEAM"},{"title":"Staging environment","description":"Set up staging WordPress site with WooCommerce","assignee_role":"TEAM"}]', CURRENT_TIMESTAMP),
  ('tmpl_design_dev', 'Design & Dev', 'DESIGN_DEV', '[{"title":"Figma mockups","description":"Create homepage and key page mockups in Figma","assignee_role":"TEAM"},{"title":"Client approval","description":"Present mockups and get client sign-off","assignee_role":"ADMIN"},{"title":"WP setup","description":"Install WordPress, WooCommerce, and required plugins","assignee_role":"TEAM"},{"title":"Theme install","description":"Install and configure theme","assignee_role":"TEAM"},{"title":"Elementor build","description":"Build pages with Elementor matching approved designs","assignee_role":"TEAM"}]', CURRENT_TIMESTAMP),
  ('tmpl_adding_content', 'Adding Content', 'ADDING_CONTENT', '[{"title":"Product uploads","description":"Upload all products with images, descriptions, and pricing","assignee_role":"TEAM"},{"title":"Copy review","description":"Review and edit all page copy","assignee_role":"ADMIN"},{"title":"Image optimization","description":"Compress and optimize all images for web","assignee_role":"TEAM"},{"title":"SEO setup","description":"Configure Yoast/RankMath, meta titles, descriptions","assignee_role":"TEAM"}]', CURRENT_TIMESTAMP),
  ('tmpl_finalizing', 'Finalizing', 'FINALIZING', '[{"title":"Cross-browser test","description":"Test on Chrome, Firefox, Safari, Edge","assignee_role":"TEAM"},{"title":"Mobile test","description":"Test responsive design on mobile devices","assignee_role":"TEAM"},{"title":"Speed optimization","description":"Run PageSpeed Insights, optimize for Core Web Vitals","assignee_role":"TEAM"},{"title":"Client walkthrough","description":"Walk client through the site, collect feedback","assignee_role":"ADMIN"},{"title":"Fix & test","description":"Address all feedback items and retest","assignee_role":"TEAM"}]', CURRENT_TIMESTAMP),
  ('tmpl_launched', 'Launched', 'LAUNCHED', '[{"title":"DNS cutover","description":"Point domain to production server","assignee_role":"TEAM"},{"title":"SSL check","description":"Verify SSL certificate is active and working","assignee_role":"TEAM"},{"title":"Post-launch monitoring","description":"Monitor site for 48 hours, check for errors","assignee_role":"TEAM"},{"title":"ManageWP onboard","description":"Add site to ManageWP for ongoing monitoring","assignee_role":"TEAM"}]', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
