-- TRUSION AI — Supabase Database Schema
-- Run this in Supabase SQL Editor after creating your project.
-- This creates the tables, indexes, and RLS policies required for production.

-- ═══════════════════════════════════════════════════════════
-- Table: user_roles
-- Authoritative user role and subscription plan.
-- Only the server (using service_role key) can write to this table.
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID REFERENCES auth.users(id) PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'free'
    CHECK (role IN ('free','basic','pro','business','admin','superadmin')),
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free','basic','pro','business')),
  billing_status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (billing_status IN ('inactive','active','past_due','cancelled','trialing')),
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly','yearly')),
  renewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role (for display purposes only — auth is server-side)
CREATE POLICY "Users can read own role"
  ON user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy for client — only the server (service_role) can modify.
-- The server bypasses RLS when using the service_role key.

-- ═══════════════════════════════════════════════════════════
-- Table: scan_logs
-- Audit trail of all AI scans performed by users.
-- Used for quota enforcement and analytics.
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS scan_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  scan_type TEXT NOT NULL CHECK (scan_type IN ('text','image','sms','link','apk','qr','screenshot','server','investment','deepfake','voice')),
  risk_score INTEGER CHECK (risk_score >= 0 AND risk_score <= 99),
  risk_level TEXT CHECK (risk_level IN ('low','medium','high','critical')),
  threat_type TEXT,
  correlation_id TEXT,
  user_feedback BOOLEAN, -- true = accurate, false = inaccurate
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_logs_user_id ON scan_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_scan_logs_created_at ON scan_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_logs_user_created ON scan_logs(user_id, created_at DESC);

ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own scan logs"
  ON scan_logs FOR SELECT
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
-- Table: payment_logs
-- Idempotent payment webhook processing log.
-- The gateway_event_id UNIQUE constraint prevents duplicate processing.
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payment_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  gateway_event_id TEXT UNIQUE NOT NULL,
  plan_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'IDR',
  status TEXT NOT NULL CHECK (status IN ('pending','success','failed','expired','refunded','cancelled')),
  gateway TEXT NOT NULL CHECK (gateway IN ('xendit','midtrans','stripe','paypal','manual')),
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly','yearly')),
  raw_event JSONB,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_logs_user_id ON payment_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_gateway_event ON payment_logs(gateway_event_id);

ALTER TABLE payment_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own payment logs"
  ON payment_logs FOR SELECT
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
-- Table: community_reports
-- User-submitted scam reports visible to all users.
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS community_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  report_type TEXT NOT NULL CHECK (report_type IN ('phone','domain','bank_account','apk','email','other')),
  report_value TEXT NOT NULL,
  category TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  report_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_reports_status ON community_reports(status);
CREATE INDEX IF NOT EXISTS idx_community_reports_type_value ON community_reports(report_type, report_value);

ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read community reports
CREATE POLICY "Authenticated users can read reports"
  ON community_reports FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any authenticated user can create a report
CREATE POLICY "Authenticated users can create reports"
  ON community_reports FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Only the report owner can update/delete their own report
CREATE POLICY "Users can update own reports"
  ON community_reports FOR UPDATE
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
-- Table: profiles
-- Extended user profile information.
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID REFERENCES auth.users(id) PRIMARY KEY,
  full_name TEXT,
  city TEXT,
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════
-- Trigger: Auto-create profile and role on signup
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (user_id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO user_roles (user_id, role, plan, billing_status)
  VALUES (NEW.id, 'free', 'free', 'inactive')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ═══════════════════════════════════════════════════════════
-- Updated_at trigger for all tables
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_roles_updated_at BEFORE UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
