// Smoke tests — verify that key pages and flows are operational.
// These run with the authenticated session saved by auth.setup.js.

import { test, expect } from '@playwright/test';

// ─── 1. App loads and is authenticated ───────────────────────────────────────
test('app loads and user is authenticated', async ({ page }) => {
  await page.goto('/');

  // Should NOT show the login screen
  await expect(page.locator('#auth-section')).toBeHidden({ timeout: 10000 });

  // Should show the main app shell
  await expect(page.locator('button[onclick="signOut()"]').first()).toBeVisible();
});

// ─── 2. Dashboard section is visible ─────────────────────────────────────────
test('dashboard section renders', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  // Dashboard nav link
  const dashBtn = page.locator('text=Dashboard').first();
  await expect(dashBtn).toBeVisible();
  await dashBtn.click();

  // A revenue or summary card should appear
  await expect(page.locator('#revenue-card, #dash-revenue, .stat-card').first()).toBeVisible({ timeout: 8000 });
});

// ─── 3. Invoices section loads ────────────────────────────────────────────────
test('invoices section loads', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('text=Invoices').first().click();
  // Invoice table or empty-state should appear
  await expect(page.locator('#invoice-list, #invoices-empty, .invoice-row').first()).toBeVisible({ timeout: 10000 });
});

// ─── 4. Add invoice form opens ────────────────────────────────────────────────
test('new invoice form opens', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('text=Invoices').first().click();
  await page.locator('#add-invoice-btn, button:has-text("New Invoice"), button:has-text("Add Invoice")').first().click();

  await expect(page.locator('#invoice-form, #inv-client, input[placeholder*="client" i]').first()).toBeVisible({ timeout: 8000 });
});

// ─── 5. Payroll section loads ─────────────────────────────────────────────────
test('payroll section loads', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('text=Payroll').first().click();
  await expect(page.locator('#payroll-section, #employees-list, .employee-card, #payroll-empty').first()).toBeVisible({ timeout: 10000 });
});

// ─── 6. Financials / bookkeeper pack section loads ────────────────────────────
test('financials section loads', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('text=Financials').first().click();
  await expect(page.locator('#financials-section, #pl-section, .financials-header').first()).toBeVisible({ timeout: 10000 });
});

// ─── 7. Shared-financials page — invalid token shows error ────────────────────
test('shared-financials page shows error for invalid token', async ({ page }) => {
  await page.goto('/shared-financials.html?token=invalid-token-123');

  // Should show an error message (expired / not found)
  await expect(page.locator('text=/not found|expired|invalid/i').first()).toBeVisible({ timeout: 15000 });
});

// ─── 8. Sign out works ───────────────────────────────────────────────────────
test('sign out returns to login screen', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('button[onclick="signOut()"]', { timeout: 20000 });

  await page.locator('button[onclick="signOut()"]').first().click();

  // Auth section / login form should reappear
  await expect(page.locator('#auth-section, #emailInput').first()).toBeVisible({ timeout: 10000 });
});
