-- 039_tenant_website_kb.sql
-- Knowledge base website crawl and compiled brokerage knowledge for AI voice calling

-- 1. Add compiled kb_text to tenants if not exists
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kb_text text DEFAULT '';

-- 2. Track crawl sources and async progress per tenant
CREATE TABLE IF NOT EXISTS tenant_kb_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'website', -- 'website', 'sub_url', 'manual'
  source_url text NOT NULL,
  status text NOT NULL DEFAULT 'queued', -- 'queued', 'crawling', 'extracting', 'ready', 'failed'
  current_step text DEFAULT 'Queued for processing',
  pages_found int DEFAULT 0,
  pages_crawled int DEFAULT 0,
  progress_percent int DEFAULT 0,
  raw_text text,
  extracted_kb text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying tenant's KB sources fast
CREATE INDEX IF NOT EXISTS idx_tenant_kb_sources_tenant_id ON tenant_kb_sources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_kb_sources_status ON tenant_kb_sources(status);
