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
  vat_registration_date date,                        -- SARS effective registration date — used to exclude pre-registration invoices from VAT201
  has_paye            boolean DEFAULT false,
  is_provisional      boolean DEFAULT false,
  year_end            text DEFAULT 'February',
  tos_accepted        boolean DEFAULT false,        -- true once user explicitly accepts Terms of Service
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
  type          text NOT NULL CHECK (type IN ('income', 'expense')),
  date          date,
  description   text,
  category      text,
  amount        numeric DEFAULT 0 CHECK (amount > 0),    -- excl VAT, must be positive
  vat           numeric DEFAULT 0 CHECK (vat >= 0),      -- zero is valid (non-VAT invoice)
  total         numeric DEFAULT 0 CHECK (total > 0 AND total >= amount),  -- incl VAT; must be >= excl-VAT amount
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
  amount              numeric DEFAULT 0 CHECK (amount > 0),   -- always positive; direction is in type field
  reference           text,
  type                text CHECK (type IN ('credit', 'debit')),  -- direction of transaction
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
  revenue                   numeric DEFAULT 0 CHECK (revenue >= 0),
  expenses                  numeric DEFAULT 0 CHECK (expenses >= 0),
  profit                    numeric DEFAULT 0,          -- can be negative (loss)
  vat_owing                 numeric DEFAULT 0,          -- can be negative (VAT refund owed)
  invoice_count             integer DEFAULT 0 CHECK (invoice_count >= 0),
  reconciliation_confidence integer DEFAULT 0 CHECK (reconciliation_confidence >= 0),
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
  ytd_revenue           numeric DEFAULT 0 CHECK (ytd_revenue >= 0),
  ytd_expenses          numeric DEFAULT 0 CHECK (ytd_expenses >= 0),
  vat_owing             numeric DEFAULT 0,          -- can be negative (VAT refund owed to business)
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
  age_bracket     text    DEFAULT 'under65',   -- 'under65' | '65to74' | 'over75' — determines PAYE rebate tier
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
  total_gross         numeric DEFAULT 0 CHECK (total_gross >= 0),
  total_net           numeric DEFAULT 0 CHECK (total_net >= 0),
  total_paye          numeric DEFAULT 0 CHECK (total_paye >= 0),
  total_uif_emp       numeric DEFAULT 0 CHECK (total_uif_emp >= 0),
  total_uif_er        numeric DEFAULT 0 CHECK (total_uif_er >= 0),
  total_sdl           numeric DEFAULT 0 CHECK (total_sdl >= 0),
  total_deductions    numeric DEFAULT 0 CHECK (total_deductions >= 0),
  employee_count      integer DEFAULT 0 CHECK (employee_count >= 0),
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


-- ── MIGRATIONS ───────────────────────────────────────────────
-- Run these once against the existing live database.
-- (The CREATE TABLE blocks above use IF NOT EXISTS so they won't
--  add new columns to an existing table automatically.)

-- M1: Add age_bracket to employees (PAYE secondary/tertiary rebates)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS age_bracket text DEFAULT 'under65';

-- M2: Add vat_registration_date to profiles (VAT201 pre-registration invoice filter)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vat_registration_date date;

-- M3: Invoices — positive amount/total, non-negative VAT
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_amount_nonneg;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_vat_nonneg;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_total_nonneg;
ALTER TABLE invoices ADD CONSTRAINT invoices_amount_pos  CHECK (amount > 0);
ALTER TABLE invoices ADD CONSTRAINT invoices_vat_nonneg  CHECK (vat    >= 0);
ALTER TABLE invoices ADD CONSTRAINT invoices_total_pos   CHECK (total  > 0);

-- M4: Payroll runs — all aggregates non-negative
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_total_gross_nonneg;
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_total_net_nonneg;
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_paye_nonneg;
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_uif_emp_nonneg;
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_uif_er_nonneg;
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_sdl_nonneg;
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_deductions_nonneg;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_total_gross_nonneg  CHECK (total_gross     >= 0);
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_total_net_nonneg    CHECK (total_net       >= 0);
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_paye_nonneg         CHECK (total_paye      >= 0);
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_uif_emp_nonneg      CHECK (total_uif_emp   >= 0);
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_uif_er_nonneg       CHECK (total_uif_er    >= 0);
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_sdl_nonneg          CHECK (total_sdl       >= 0);
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_deductions_nonneg   CHECK (total_deductions >= 0);

-- M5: Bank transactions — amount > 0 (always positive; direction in type field) + type constraint
ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS bank_tx_amount_nonneg;
ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS bank_tx_amount_pos;
ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS bank_tx_type_valid;
ALTER TABLE bank_transactions ADD CONSTRAINT bank_tx_amount_pos  CHECK (amount > 0);
ALTER TABLE bank_transactions ADD CONSTRAINT bank_tx_type_valid  CHECK (type IN ('credit', 'debit'));

-- M5a: Invoices — unique invoice number per user (income invoices only, excludes quotes and NULL numbers)
CREATE UNIQUE INDEX IF NOT EXISTS invoices_unique_invoice_number
  ON invoices (user_id, invoice_number)
  WHERE invoice_number IS NOT NULL AND type = 'income' AND doc_type = 'invoice';

-- M5b: Invoices — type constraint + total >= amount integrity check
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_type_valid;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_total_gte_amount;
ALTER TABLE invoices ADD CONSTRAINT invoices_type_valid       CHECK (type IN ('income', 'expense'));
ALTER TABLE invoices ADD CONSTRAINT invoices_total_gte_amount CHECK (total >= amount);

-- M6: Monthly snapshots — revenue and expenses non-negative
ALTER TABLE monthly_snapshots DROP CONSTRAINT IF EXISTS snapshots_revenue_nonneg;
ALTER TABLE monthly_snapshots DROP CONSTRAINT IF EXISTS snapshots_expenses_nonneg;
ALTER TABLE monthly_snapshots ADD CONSTRAINT snapshots_revenue_nonneg  CHECK (revenue  >= 0);
ALTER TABLE monthly_snapshots ADD CONSTRAINT snapshots_expenses_nonneg CHECK (expenses >= 0);

-- M8: Add tos_accepted to profiles (forced Terms acceptance on first login)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tos_accepted boolean DEFAULT false;

-- M7: Opening balances — ytd figures non-negative
ALTER TABLE opening_balances DROP CONSTRAINT IF EXISTS ob_ytd_revenue_nonneg;
ALTER TABLE opening_balances DROP CONSTRAINT IF EXISTS ob_ytd_expenses_nonneg;
ALTER TABLE opening_balances ADD CONSTRAINT ob_ytd_revenue_nonneg  CHECK (ytd_revenue  >= 0);
ALTER TABLE opening_balances ADD CONSTRAINT ob_ytd_expenses_nonneg CHECK (ytd_expenses >= 0);
