// Smoke tests — verify that key pages and flows are operational.
// These run with the authenticated session saved by auth.setup.js.

import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://onetouch.net.za';

// ─── 1. App loads and is authenticated ───────────────────────────────────────
test('app loads and user is authenticated', async ({ page }) => {
  await page.goto('/business.html');

  // Auth screen should be hidden
  await expect(page.locator('#authScreen')).toBeHidden({ timeout: 15000 });

  // Sign-out button visible = authenticated app shell loaded
  await expect(page.locator('button[onclick="signOut()"]').first()).toBeVisible({ timeout: 15000 });
});

// ─── 2. Dashboard section renders ────────────────────────────────────────────
test('dashboard section renders', async ({ page }) => {
  await page.goto('/business.html');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  // Dashboard is the default active section — stat cards should already be visible
  await expect(page.locator('#section-dashboard')).toBeVisible();
  await expect(page.locator('#complianceScore')).toBeVisible({ timeout: 10000 });
});

// ─── 3. Invoices section loads ────────────────────────────────────────────────
test('invoices section loads', async ({ page }) => {
  await page.goto('/business.html');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('.s-btn[onclick*="invoices"]').first().click();
  await expect(page.locator('#section-invoices')).toBeVisible({ timeout: 10000 });
  // Either the invoice list or the empty state should appear
  await expect(page.locator('#section-invoices .add-inv-btn')).toBeVisible({ timeout: 10000 });
});

// ─── 4. Add invoice form opens ────────────────────────────────────────────────
test('new invoice form opens', async ({ page }) => {
  await page.goto('/business.html');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('.s-btn[onclick*="invoices"]').first().click();
  await page.locator('.add-inv-btn').first().click();

  await expect(page.locator('#invFormOverlay')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#inv-client')).toBeVisible();
});

// ─── 5. Payroll section loads ─────────────────────────────────────────────────
test('payroll section loads', async ({ page }) => {
  await page.goto('/business.html');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('.s-btn[onclick*="payroll"]').first().click();
  await expect(page.locator('#section-payroll')).toBeVisible({ timeout: 10000 });
});

// ─── 6. Financials section loads ──────────────────────────────────────────────
test('financials section loads', async ({ page }) => {
  await page.goto('/business.html');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('.s-btn[onclick*="financials"]').first().click();
  await expect(page.locator('#section-financials')).toBeVisible({ timeout: 10000 });
});

// ─── 7. Shared-financials page — invalid token shows error ────────────────────
test('shared-financials page shows error for invalid token', async ({ page }) => {
  await page.goto(`${BASE}/shared-financials.html?token=invalid-token-123`);
  await expect(page.locator('text=/not found|expired|invalid|error/i').first()).toBeVisible({ timeout: 15000 });
});

// ─── 8. Sign out works ───────────────────────────────────────────────────────
test('sign out returns to login screen', async ({ page }) => {
  await page.goto('/business.html');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('button[onclick="signOut()"]').first().click();

  await expect(page.locator('#authScreen')).toBeVisible({ timeout: 10000 });
});
