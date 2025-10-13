-- Supabase schema for Dexto gateway (MVP)

-- 1) API keys (DEXTO_API_KEY)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,           -- SHA-256 of plaintext key
  scope TEXT NOT NULL DEFAULT 'gateway',
  status TEXT NOT NULL DEFAULT 'active', -- active | revoked
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_api_keys_user_active ON api_keys(user_id) WHERE status = 'active';
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_read_api_keys" ON api_keys FOR SELECT USING (auth.uid() = user_id);

-- 2) Wallet balances (credits in cents)
CREATE TABLE IF NOT EXISTS balances (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_cents BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_read_balances" ON balances FOR SELECT USING (auth.uid() = user_id);

-- 3) Usage ledger
CREATE TABLE IF NOT EXISTS usage_ledger (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  input_tokens BIGINT,
  output_tokens BIGINT,
  cost_cents BIGINT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON usage_ledger(user_id, ts DESC);
ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_read_usage" ON usage_ledger FOR SELECT USING (auth.uid() = user_id);

-- 4) Existing per-user OpenRouter keys (encrypted) – as in current repo (reference)
-- Table: openrouter_keys (see ../functions/supabase/migrations/...)

