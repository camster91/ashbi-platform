BEGIN;
-- Keep every existing profile bound. Only the closed plugin set expands;
-- defaults remain read-only client-work, so task proposals stay opt-in.
ALTER TABLE "client_agent_profiles" DROP CONSTRAINT "client_agent_profile_bounds";
ALTER TABLE "client_agent_profiles" ADD CONSTRAINT "client_agent_profile_bounds" CHECK (
  char_length(btrim("name")) BETWEEN 1 AND 100 AND char_length("instructions") <= 2000
  AND "revision" > 0 AND "portalEnabled" = false
  AND CASE WHEN jsonb_typeof("pluginIds") = 'array' THEN
    jsonb_array_length("pluginIds") <= 2
    AND "pluginIds" <@ '["client-work", "client-task-actions"]'::jsonb
    AND (jsonb_array_length("pluginIds") = 0 OR jsonb_typeof("pluginIds"->0) = 'string')
    AND (jsonb_array_length("pluginIds") < 2 OR
      (jsonb_typeof("pluginIds"->1) = 'string' AND "pluginIds"->0 <> "pluginIds"->1))
  ELSE false END
);
COMMIT;
