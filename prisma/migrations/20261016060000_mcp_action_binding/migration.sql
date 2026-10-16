-- Existing API-key/session receipts remain NULL and retain their existing policy.
ALTER TABLE "ai_bridge_actions" ADD COLUMN "authorizationBinding" JSONB;
ALTER TABLE "ai_bridge_actions" ADD CONSTRAINT ai_action_oauth_binding_shape CHECK (
  "authorizationBinding" IS NULL OR (
    jsonb_typeof("authorizationBinding") = 'object'
    AND "authorizationBinding" ?& ARRAY['kind','keyId','userId','organizationId','sessionVersion','clientId','requiredScope']
    AND "authorizationBinding" - ARRAY['kind','keyId','userId','organizationId','sessionVersion','clientId','requiredScope'] = '{}'::jsonb
    AND "authorizationBinding"->>'kind' = 'mcp_oauth'
    AND jsonb_typeof("authorizationBinding"->'keyId') = 'string'
    AND length("authorizationBinding"->>'keyId') BETWEEN 1 AND 128
    AND "authorizationBinding"->>'userId' = "userId"
    AND "authorizationBinding"->>'organizationId' = "organizationId"
    AND "authorizationBinding"->>'clientId' = 'https://chatgpt.com/oauth/client.json'
    AND jsonb_typeof("authorizationBinding"->'sessionVersion') = 'number'
    AND ("authorizationBinding"->>'sessionVersion') ~ '^[0-9]{1,10}$'
    AND "source" = 'ai_bridge'
    AND (("action" = 'create_client_task' AND "authorizationBinding"->>'requiredScope' = 'workspace:client-tasks:write')
      OR ("action" = 'publish_client_service_report_snapshot' AND "authorizationBinding"->>'requiredScope' = 'workspace:service-reports:publish'))
  ) IS TRUE
);
CREATE FUNCTION preserve_mcp_action_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."authorizationBinding" IS DISTINCT FROM OLD."authorizationBinding" THEN
    RAISE EXCEPTION 'Action authorization binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ai_action_binding_immutable BEFORE UPDATE ON "ai_bridge_actions"
FOR EACH ROW EXECUTE FUNCTION preserve_mcp_action_binding();
