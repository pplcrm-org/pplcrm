import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

/**
 * Critical journey #2: the first REAL end-to-end path — no route stubbing anywhere in this
 * file. It signs UP a throwaway tenant against the running backend, passes the two signup
 * gates, completes the two-step sign-in, lands on the authenticated dashboard, opens the
 * People grid, and signs out.
 *
 * Environment contract (see the `verify` skill and playwright.config.ts):
 *  - Backend on :3000, frontend on :4200 — the webServer block starts both; local runs
 *    attach to dev servers that are already up.
 *  - Postgres reachable with the same DB_* env the backend uses. Two gates hold a fresh
 *    tenant out of EVERY sign-in path (password, 2FA, passkey):
 *      1. email verification (`authusers.verified`),
 *      2. the closed-beta approval gate (`tenants.approval_status`).
 *    AUTO_APPROVE_TENANTS must stay UNSET in this spec's environment: with it, signUp
 *    issues session tokens immediately, the browser lands signed-in on the dashboard, and
 *    the sign-in steps below wait forever on a page that no longer exists (the 2026-08-22
 *    CI failure; verify.yml's e2e job documents the same rule). Unset, signup bounces to
 *    /signin and the documented dev/test way past the gates is flipping the rows directly
 *    (verify skill), which `unlockThrowawayTenant` below does for both, idempotently.
 *
 * Each run signs up a fresh tenant (timestamped email) so the test is rerunnable without
 * cleanup. Throwaway tenants accumulate in the dev DB by design: tenant DELETE does not
 * cascade everywhere, so they are left in place (verify skill).
 */

const RUN_ID = Date.now();
/** Unique per run — signUp refuses an email that already has an account. */
const EMAIL = `e2e.journey.${RUN_ID}@example.com`;
/** Unique per run — the backend rejects any password found in a breach corpus (HIBP). */
const PASSWORD = `Vf-${RUN_ID}-Xq7!pplcrm`;
const FIRST_NAME = 'Journey';
const ORG_NAME = `E2E Journey ${RUN_ID}`;

/**
 * Flip the throwaway tenant past the email-verification and beta-approval gates, the way
 * the verify skill documents for local/dev runs. Connects with the same DB_* env vars CI
 * gives the backend; the fallbacks are the local dev database (trust auth, no password).
 */
async function unlockThrowawayTenant(email: string): Promise<void> {
  const migrationUser = process.env['DB_MIGRATION_USER'];
  const client = new Client({
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? '5432'),
    database: process.env['DB_NAME'] ?? 'pplcrm',
    user: migrationUser ?? process.env['DB_USER'] ?? 'pplcrm_owner',
    password: (migrationUser ? process.env['DB_MIGRATION_PASSWORD'] : process.env['DB_PASSWORD']) ?? undefined,
  });
  await client.connect();
  try {
    const verified = await client.query('UPDATE authusers SET verified = true WHERE email = $1', [email]);
    if (verified.rowCount !== 1) {
      throw new Error(`Signup did not create an authusers row for ${email} (matched ${verified.rowCount ?? 0}).`);
    }
    // No-op when AUTO_APPROVE_TENANTS=true already approved it at signup.
    await client.query(
      `UPDATE tenants
          SET approval_status = 'approved', approved_at = now(), approval_token_hash = NULL
        WHERE id = (SELECT tenant_id FROM authusers WHERE email = $1)
          AND approval_status <> 'approved'`,
      [email],
    );
  } finally {
    await client.end();
  }
}

/**
 * Strip Vite's error overlay continuously (verify skill): a TS error anywhere in the watched
 * workspace renders a click-swallowing <vite-error-overlay> even on pages that are fine.
 */
async function stripViteErrorOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    setInterval(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove()), 200);
  });
}

test.describe('Authenticated journey (real backend)', () => {
  // The signup transaction seeds starter tags, starter forms AND the demo dataset, and a cold
  // CI runner compiles both apps first — generous, but still a bound rather than forever.
  test.setTimeout(240_000);

  test('@smoke signs up a throwaway tenant, signs in, lands on the dashboard, opens People', async ({ page }) => {
    await stripViteErrorOverlay(page);

    // ---- (a) Sign up through the real UI: step 1, then skip the two optional steps ----
    await page.goto('/signup');
    await page.getByPlaceholder('Your first name').fill(FIRST_NAME);
    await page.getByPlaceholder('Organization name (or self)').fill(ORG_NAME);
    await page.getByPlaceholder('Enter your email').fill(EMAIL);
    await page.getByPlaceholder('Enter your password').fill(PASSWORD);
    await page.getByRole('button', { name: /Continue/ }).click();

    await expect(page.getByText('What you organize')).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(page.getByText('How to reach you')).toBeVisible();
    // Step 3's skip is the submit: the workspace (tenant, owner, office campaign, demo data)
    // is created inside one backend transaction here.
    await page.getByRole('button', { name: 'Skip for now' }).click();

    // Signup always bounces to /signin — with the verification-pending panel, or the
    // waiting-for-approval panel when the beta gate held the tenant. Both are handled next.
    await expect(page).toHaveURL(/\/signin/, { timeout: 120_000 });

    // ---- Gates: verify the email + approve the tenant directly in the DB --------------
    await unlockThrowawayTenant(EMAIL);

    // ---- (b) Two-step sign-in with the created credentials ----------------------------
    // Full reload without the ?verificationPending param, so the page starts clean on the
    // email step instead of showing the pending panel.
    await page.goto('/signin');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter your password')).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // A fresh account has no passkeys and has not dismissed the prompt, so the post-sign-in
    // passkey upsell interstitial always appears — dismiss it (verify skill).
    await expect(page.getByRole('heading', { name: 'Sign in faster with a passkey' })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole('button', { name: 'Skip for now' }).click();

    // ---- (c) The authenticated shell renders real data from the real backend ----------
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    // The greeting's name comes from the signed-in user record the backend returned — it
    // proves an authenticated round-trip, not just a rendered route.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      new RegExp(`Good (morning|afternoon|evening), ${FIRST_NAME}`),
      { timeout: 60_000 },
    );

    // ---- (d) One record surface: the People grid renders with rows --------------------
    await page.goto('/people');
    // Substring match, not exact: the header cell's accessible name includes its resize
    // handle ("Name Resize column"). No other rendered People column contains "Name".
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible({ timeout: 60_000 });
    // A fresh workspace starts in demo mode, so the grid has seeded people — at least one
    // real row proves the grid queried the backend rather than rendering an empty shell.
    await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 60_000 });

    // ---- (e) Sign out ------------------------------------------------------------------
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByText('Sign out', { exact: true }).click();
    await expect(page).toHaveURL(/\/signin/, { timeout: 30_000 });
  });
});
