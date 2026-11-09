CREATE TABLE meta_ad_accounts (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 business_name TEXT NOT NULL DEFAULT '',
 business_portfolio_id TEXT NOT NULL DEFAULT '',
 ashbi_business_id TEXT NOT NULL DEFAULT '' CHECK(length(ashbi_business_id)<=100),
 facebook_page_name TEXT NOT NULL DEFAULT '',
 facebook_page_id TEXT NOT NULL DEFAULT '',
 instagram_handle TEXT NOT NULL DEFAULT '',
 instagram_account_id TEXT NOT NULL DEFAULT '',
 ad_account_id TEXT NOT NULL DEFAULT '',
 dataset_id TEXT NOT NULL DEFAULT '',
 website_url TEXT NOT NULL DEFAULT '',
 service_areas_json TEXT NOT NULL DEFAULT '[]',
 currency TEXT NOT NULL DEFAULT 'CAD' CHECK(currency IN ('CAD','USD','EUR','GBP')),
 timezone TEXT NOT NULL DEFAULT 'America/Toronto',
 partner_access_status TEXT NOT NULL DEFAULT 'not_requested' CHECK(partner_access_status IN ('not_requested','requested','granted','blocked')),
 checklist_json TEXT NOT NULL DEFAULT '{}',
 notes TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(organization_id,client_id),
 UNIQUE(id,organization_id),
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(created_by) REFERENCES actors(id),
 CHECK(length(business_name)<=200),
 CHECK(length(business_portfolio_id)<=100),
 CHECK(length(facebook_page_id)<=100),
 CHECK(length(instagram_account_id)<=100),
 CHECK(length(ad_account_id)<=100),
 CHECK(length(dataset_id)<=100),
 CHECK(length(website_url)<=2048),
 CHECK(length(timezone)<=64),
 CHECK(length(notes)<=4000)
);
CREATE INDEX meta_ad_accounts_org ON meta_ad_accounts(organization_id,updated_at DESC);

CREATE TABLE meta_ad_campaigns (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 objective TEXT NOT NULL CHECK(objective IN ('leads','traffic','engagement','sales','awareness')),
 conversion_location TEXT NOT NULL CHECK(conversion_location IN ('instant_form','website','messages')),
 daily_budget_minor INTEGER NOT NULL CHECK(daily_budget_minor BETWEEN 0 AND 100000000),
 currency TEXT NOT NULL CHECK(currency IN ('CAD','USD','EUR','GBP')),
 service_area TEXT NOT NULL DEFAULT '' CHECK(length(service_area)<=300),
 start_date TEXT,
 end_date TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','awaiting_approval','approved','entered_in_meta','paused','completed')),
 client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN (0,1)),
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(id,organization_id,client_id),
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(created_by) REFERENCES actors(id),
 CHECK(start_date IS NULL OR length(start_date)=10),
 CHECK(end_date IS NULL OR length(end_date)=10),
 CHECK(end_date IS NULL OR start_date IS NULL OR end_date>=start_date)
);
CREATE INDEX meta_ad_campaigns_client ON meta_ad_campaigns(organization_id,client_id,updated_at DESC);

CREATE TABLE meta_ad_creatives (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 format TEXT NOT NULL CHECK(format IN ('feed_portrait','feed_square','story_reel','carousel')),
 primary_text TEXT NOT NULL DEFAULT '' CHECK(length(primary_text)<=5000),
 headline TEXT NOT NULL DEFAULT '' CHECK(length(headline)<=255),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=500),
 cta TEXT NOT NULL DEFAULT 'get_quote' CHECK(cta IN ('get_quote','learn_more','send_message','sign_up','book_now')),
 asset_reference TEXT NOT NULL DEFAULT '' CHECK(length(asset_reference)<=2048),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','awaiting_approval','approved','changes_requested')),
 client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_by TEXT NOT NULL,
 reviewed_by TEXT,
 reviewed_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(campaign_id,organization_id,client_id) REFERENCES meta_ad_campaigns(id,organization_id,client_id),
 FOREIGN KEY(created_by) REFERENCES actors(id),
 FOREIGN KEY(reviewed_by) REFERENCES actors(id)
);
CREATE INDEX meta_ad_creatives_campaign ON meta_ad_creatives(organization_id,client_id,campaign_id,updated_at DESC);

CREATE TABLE meta_ad_approvals (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 creative_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approved','changes_requested')),
 feedback TEXT NOT NULL DEFAULT '' CHECK(length(feedback)<=2000),
 created_at INTEGER NOT NULL,
 FOREIGN KEY(creative_id) REFERENCES meta_ad_creatives(id),
 FOREIGN KEY(actor_id) REFERENCES actors(id)
);
CREATE INDEX meta_ad_approvals_creative ON meta_ad_approvals(organization_id,creative_id,created_at DESC);

CREATE TABLE meta_ad_leads (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 campaign_id TEXT,
 full_name TEXT NOT NULL CHECK(length(full_name) BETWEEN 1 AND 160),
 email TEXT NOT NULL DEFAULT '' CHECK(length(email)<=254),
 phone TEXT NOT NULL DEFAULT '' CHECK(length(phone)<=40),
 city TEXT NOT NULL DEFAULT '' CHECK(length(city)<=120),
 service TEXT NOT NULL DEFAULT '' CHECK(length(service)<=160),
 stage TEXT NOT NULL DEFAULT 'new' CHECK(stage IN ('new','contacted','qualified','estimate_booked','won','lost')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 follow_up_on TEXT,
 client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN (0,1)),
 internal_notes TEXT NOT NULL DEFAULT '' CHECK(length(internal_notes)<=2000),
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(campaign_id,organization_id,client_id) REFERENCES meta_ad_campaigns(id,organization_id,client_id),
 FOREIGN KEY(created_by) REFERENCES actors(id),
 CHECK(email<>'' OR phone<>''),
 CHECK(follow_up_on IS NULL OR length(follow_up_on)=10)
);
CREATE INDEX meta_ad_leads_client ON meta_ad_leads(organization_id,client_id,created_at DESC);
CREATE INDEX meta_ad_leads_stage ON meta_ad_leads(organization_id,client_id,stage,follow_up_on);

CREATE TABLE meta_ad_reports (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL,
 report_date TEXT NOT NULL CHECK(length(report_date)=10),
 spend_minor INTEGER NOT NULL CHECK(spend_minor>=0),
 revenue_minor INTEGER NOT NULL CHECK(revenue_minor>=0),
 currency TEXT NOT NULL CHECK(currency IN ('CAD','USD','EUR','GBP')),
 impressions INTEGER NOT NULL CHECK(impressions>=0),
 reach INTEGER NOT NULL CHECK(reach>=0),
 clicks INTEGER NOT NULL CHECK(clicks>=0),
 leads INTEGER NOT NULL CHECK(leads>=0),
 qualified_leads INTEGER NOT NULL CHECK(qualified_leads>=0),
 estimates_booked INTEGER NOT NULL CHECK(estimates_booked>=0),
 jobs_won INTEGER NOT NULL CHECK(jobs_won>=0),
 client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN (0,1)),
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(organization_id,campaign_id,report_date),
 FOREIGN KEY(campaign_id,organization_id,client_id) REFERENCES meta_ad_campaigns(id,organization_id,client_id),
 FOREIGN KEY(created_by) REFERENCES actors(id)
);
CREATE INDEX meta_ad_reports_client ON meta_ad_reports(organization_id,client_id,report_date DESC);

CREATE TABLE meta_ad_activity (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 client_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 entity_type TEXT NOT NULL CHECK(entity_type IN ('account','campaign','creative','lead','report')),
 entity_id TEXT NOT NULL,
 action TEXT NOT NULL,
 detail_json TEXT NOT NULL DEFAULT '{}',
 created_at INTEGER NOT NULL,
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(actor_id) REFERENCES actors(id)
);
CREATE INDEX meta_ad_activity_client ON meta_ad_activity(organization_id,client_id,created_at DESC);
