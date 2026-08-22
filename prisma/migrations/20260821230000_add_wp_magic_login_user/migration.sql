-- Store the intended WordPress administrator per managed site.  A Hub magic
-- login must never assume that WordPress user ID 1 belongs to the agency.
ALTER TABLE "wp_sites" ADD COLUMN "magicLoginUserId" INTEGER;
