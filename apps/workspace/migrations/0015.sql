CREATE TABLE cancelled_stripe_customer_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, request_key TEXT NOT NULL CHECK(length(request_key)=36),
 actor_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(organization_id,request_key), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE TABLE cancelled_stripe_invoice_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, request_key TEXT NOT NULL CHECK(length(request_key)=36),
 actor_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(organization_id,request_key), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id)
);
