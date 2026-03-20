-- ============================================================
-- OneTouch TaxApp — Master Supabase Schema
-- Safe to run in full at any time (IF NOT EXISTS throughout)
-- Run in: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================


-- ── 1. PROFILES ─────────────────────────────────────────────
-- One row per user. Created on first login / onboarding.

CREATE TABLE IF NOT EXISTS profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  biz_name            text,
  owner_name          text,
  entity_type         text DEFAULT 'sole_prop',
  vat_registered      boolean DEFAULT false,
  vat_number          text,
  has_paye            boolean DEFAULT false,
  is_provisional      boolean DEFAULT false,
  year_end            text DEFAULT 'February',
  plan                text DEFAULT 'free',         -- 'free' | 'pro' | 'full'
  ai_calls            integer DEFAULT 0,
  ai_calls_month      text,                        -- 'YYYY-MM' — resets counter when month changes
  share_token         text,
  share_token_email   text,
  share_token_expiry  timestamptz,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own profile" ON profiles;
CREATE POLICY "Users manage own profile" ON profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);


-- ── 2. INVOICES ─────────────────────────────────────────────
-- Income and expense entries. Core financial data.

CREATE TABLE IF NOT EXISTS invoices (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type          text NOT NULL,                     -- 'income' | 'expense'
  date          date,
  description   text,
  category      text,
  amount        numeric DEFAULT 0,                 -- excl VAT
  vat           numeric DEFAULT 0,
  total         numeric DEFAULT 0,                 -- incl VAT
  has_vat       boolean DEFAULT false,
  reconciled    boolean DEFAULT false,
  status        text DEFAULT 'outstanding',        -- 'outstanding' | 'paid' | 'partial'
  status_log    text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own invoices" ON invoices;
CREATE POLICY "Users manage own invoices" ON invoices
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 3. STATEMENTS ───────────────────────────────────────────
-- Log of every bank statement uploaded and AI-analysed.

CREATE TABLE IF NOT EXISTS statements (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  filename        text,
  period          text,
  total_income    numeric DEFAULT 0,
  total_expenses  numeric DEFAULT 0,
  vat_liability   numeric DEFAULT 0,
  flag_count      integer DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own statements" ON statements;
CREATE POLICY "Users manage own statements" ON statements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 4. RECONCILIATION SESSIONS ──────────────────────────────
-- One session per user per calendar month (period = 'YYYY-MM').

CREATE TABLE IF NOT EXISTS reconciliation_sessions (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  period            text,                          -- e.g. '2026-03'
  confidence        integer DEFAULT 0,             -- 0–100
  locked            boolean DEFAULT false,
  mid_month_done    boolean DEFAULT false,
  mid_month_done_at timestamptz,
  month_end_done    boolean DEFAULT false,
  month_end_done_at timestamptz,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE reconciliation_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own recon sessions" ON reconciliation_sessions;
CREATE POLICY "Users manage own recon sessions" ON reconciliation_sessions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 5. BANK TRANSACTIONS ────────────────────────────────────
-- Individual rows from uploaded bank statements, linked to a session.

CREATE TABLE IF NOT EXISTS bank_transactions (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id          uuid REFERENCES reconciliation_sessions(id) ON DELETE CASCADE,
  date                date,
  description         text,
  amount              numeric DEFAULT 0,
  reference           text,
  type                text,                        -- 'credit' | 'debit'
  match_status        text DEFAULT 'unmatched',   -- 'unmatched' | 'suggested' | 'matched'
  matched_invoice_id  uuid REFERENCES invoices(id) ON DELETE SET NULL,
  match_type          text,                        -- 'auto' | 'fuzzy' | 'manual' | 'confirmed'
  classification      text,
  ignored             boolean DEFAULT false,
  ignore_reason       text,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own bank transactions" ON bank_transactions;
CREATE POLICY "Users manage own bank transactions" ON bank_transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 6. MONTHLY SNAPSHOTS ────────────────────────────────────
-- Point-in-time financial summaries, one per month.

CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id                        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                   uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month_key                 text,                  -- 'YYYY-MM'
  month_label               text,                  -- e.g. 'March 2026'
  year                      integer,
  revenue                   numeric DEFAULT 0,
  expenses                  numeric DEFAULT 0,
  profit                    numeric DEFAULT 0,
  vat_owing                 numeric DEFAULT 0,
  invoice_count             integer DEFAULT 0,
  reconciliation_confidence integer DEFAULT 0,
  saved_at                  timestamptz DEFAULT now()
);

ALTER TABLE monthly_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own snapshots" ON monthly_snapshots;
CREATE POLICY "Users manage own snapshots" ON monthly_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 7. DOCUMENT HISTORY ─────────────────────────────────────
-- Log of every SARS document generated (VAT201, EMP201, etc).

CREATE TABLE IF NOT EXISTS doc_history (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  doc_type    text,                                -- 'VAT201' | 'EMP201' | 'IRP6' | etc.
  reference   text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE doc_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own doc history" ON doc_history;
CREATE POLICY "Users manage own doc history" ON doc_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 8. OPENING BALANCES ─────────────────────────────────────
-- One row per user — upserted, not appended.

CREATE TABLE IF NOT EXISTS opening_balances (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  -- Balance sheet (legacy fields kept for compatibility)
  cash_balance          numeric DEFAULT 0,
  accounts_receivable   numeric DEFAULT 0,
  accounts_payable      numeric DEFAULT 0,
  -- App fields (used by saveOpeningBalances)
  year_start            text,
  verify_date           date,
  accountant_name       text,
  ytd_revenue           numeric DEFAULT 0,
  ytd_expenses          numeric DEFAULT 0,
  vat_owing             numeric DEFAULT 0,
  as_at_date            date,
  notes                 text,
  created_at            timestamptz DEFAULT now()
);

-- Add ai_calls_month to profiles if table already exists (safe to re-run)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_calls_month text;

-- Add columns if table already exists (safe to re-run)
ALTER TABLE opening_balances ADD COLUMN IF NOT EXISTS year_start        text;
ALTER TABLE opening_balances ADD COLUMN IF NOT EXISTS verify_date       date;
ALTER TABLE opening_balances ADD COLUMN IF NOT EXISTS accountant_name   text;
ALTER TABLE opening_balances ADD COLUMN IF NOT EXISTS ytd_revenue       numeric DEFAULT 0;
ALTER TABLE opening_balances ADD COLUMN IF NOT EXISTS ytd_expenses      numeric DEFAULT 0;

ALTER TABLE opening_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own opening balances" ON opening_balances;
CREATE POLICY "Users manage own opening balances" ON opening_balances
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 9. EMPLOYEES ────────────────────────────────────────────
-- Payroll employee records. Soft-deleted via active = false.

CREATE TABLE IF NOT EXISTS employees (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name            text NOT NULL,
  id_num          text,
  role            text,
  emp_type        text DEFAULT 'full_time',        -- 'full_time' | 'part_time' | 'contract'
  gross           numeric DEFAULT 0,
  travel          numeric DEFAULT 0,
  housing         numeric DEFAULT 0,
  bonus           numeric DEFAULT 0,
  medical         numeric DEFAULT 0,
  pension         numeric DEFAULT 0,
  period          text DEFAULT 'monthly',          -- 'monthly' | 'weekly' | 'fortnightly'
  uif_applicable  boolean DEFAULT true,
  sdl_applicable  boolean DEFAULT true,
  active          boolean DEFAULT true,
  updated_at      timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own employees" ON employees;
CREATE POLICY "Users manage own employees" ON employees
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 10. PAYROLL RUNS ────────────────────────────────────────
-- One row per payroll run. Links to expense invoices created.

CREATE TABLE IF NOT EXISTS payroll_runs (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  period_month        text,                        -- 'YYYY-MM'
  period_label        text,                        -- e.g. 'March 2026'
  run_date            date,
  status              text DEFAULT 'calculated',  -- 'calculated' | 'posted' | 'paid' | 'verified'
  total_gross         numeric DEFAULT 0,
  total_net           numeric DEFAULT 0,
  total_paye          numeric DEFAULT 0,
  total_uif_emp       numeric DEFAULT 0,
  total_uif_er        numeric DEFAULT 0,
  total_sdl           numeric DEFAULT 0,
  total_deductions    numeric DEFAULT 0,
  employee_count      integer DEFAULT 0,
  employee_snapshot   jsonb,
  salary_invoice_id   uuid REFERENCES invoices(id) ON DELETE SET NULL,
  paye_invoice_id     uuid REFERENCES invoices(id) ON DELETE SET NULL,
  updated_at          timestamptz DEFAULT now(),
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own payroll runs" ON payroll_runs;
CREATE POLICY "Users manage own payroll runs" ON payroll_runs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ── 11. RECONCILIATION AUDIT LOG ─────────────────────────────────────────────
-- Immutable tamper-evident audit trail for every reconciliation action.
-- Written by the app on every match, ignore, classify, and session event.

CREATE TABLE IF NOT EXISTS recon_audit (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id   uuid REFERENCES reconciliation_sessions(id) ON DELETE SET NULL,
  type         text NOT NULL,   -- 'auto' | 'suggest' | 'manual' | 'ignore' | 'upload' | 'close' | 'reset' | 'clear'
  message      text NOT NULL,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE recon_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own audit log" ON recon_audit;
CREATE POLICY "Users read own audit log" ON recon_audit
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own audit log" ON recon_audit;
CREATE POLICY "Users insert own audit log" ON recon_audit
  FOR INSERT WITH CHECK (auth.uid() = user_id);
