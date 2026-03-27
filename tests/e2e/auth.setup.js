// Auth setup — runs once before all authenticated tests.
// Uses the Supabase admin API to generate a magic link for the test account,
// navigates to it, then saves the browser storage state so tests can reuse it.
//
// Required env vars:
//   TEST_EMAIL            — email address of the test Supabase account
//   SUPABASE_SERVICE_KEY  — service-role key (from Vercel env or .env.local)

import { test as setup, expect } from '@playwright/test';
import path from 'path';

const AUTH_FILE = path.join(import.meta.dirname, '.auth/user.json');

const SUPABASE_URL = 'https://stcxldjcagyxjfwfforx.supabase.co';

setup('authenticate', async ({ page }) => {
  const email = process.env.TEST_EMAIL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!email)      throw new Error('TEST_EMAIL env var is required');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY env var is required');

  // Ask Supabase to generate a one-time magic link for the test account
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generateLink`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      type: 'magiclink',
      email,
      options: { redirectTo: process.env.BASE_URL || 'https://onetouch.net.za' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to generate magic link: ${res.status} — ${body}`);
  }

  const { action_link } = await res.json();
  if (!action_link) throw new Error('Supabase did not return action_link');

  // Follow the magic link — Supabase sets the session in localStorage via the fragment
  await page.goto(action_link);

  // Wait until the app shell is visible (sign-out button = authenticated)
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 25000 });

  // Save storage state for authenticated test projects
  await page.context().storageState({ path: AUTH_FILE });
});
