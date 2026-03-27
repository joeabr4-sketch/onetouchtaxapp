// ── OneTouch TaxApp — Supabase Client ─────────────────────────────────────────
// Single source of truth for the database connection.

const { createClient } = supabase;
const sb = createClient(
  'https://stcxldjcagyxjfwfforx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0Y3hsZGpjYWd5eGpmd2Zmb3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MjI3ODUsImV4cCI6MjA4ODE5ODc4NX0.kGmiqXZ9TYsO58pCSLuZg7kUiwknxFpF14N2i0Q-Wis',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } }
);
