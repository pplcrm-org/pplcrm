import { expect, test, type Page } from '@playwright/test';

/**
 * Sign-in is critical journey #1: every other authenticated surface is behind it, so the
 * `@smoke` tests here are the ones CI gates deploys on (see .github/workflows/verify.yml).
 *
 * The page is a STATE MACHINE, not a single form (apps/frontend/src/app/auth/signin-page):
 *   'email' -> Continue -> auth.checkEmail -> 'passkey' (hasPasskeys) | 'password'
 * There is no password field on first paint. Tests that need it must go through
 * `gotoPasswordStep()`, which stubs auth.checkEmail so the step transition is deterministic
 * and does not depend on a running backend.
 */

/** Stub auth.checkEmail so Continue lands on the password step (no passkey, no backend). */
async function stubCheckEmail(page: Page, hasPasskeys = false): Promise<void> {
  await page.route(/\/auth\.checkEmail/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: { data: { json: { hasPasskeys } } } }),
    }),
  );
}

/** Drive the email step and land on the password step. */
async function gotoPasswordStep(page: Page, email = 'test@example.com'): Promise<void> {
  await stubCheckEmail(page);
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter your password')).toBeVisible();
}

test.describe('Authentication', () => {
  test.describe('Email step', () => {
    test('@smoke loads the sign-in page on the email step', async ({ page }) => {
      await page.goto('/signin');
      await expect(page.getByText('Enter your email to sign in')).toBeVisible();
    });

    test('@smoke shows the email field and Continue, but no password yet', async ({ page }) => {
      await page.goto('/signin');

      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
      // The password field belongs to a later step — asserting its absence is what pins
      // the two-step contract in place.
      await expect(page.getByLabel('Password')).toHaveCount(0);
    });

    test('rejects an invalid email instead of advancing', async ({ page }) => {
      await stubCheckEmail(page);
      await page.goto('/signin');

      await page.getByLabel('Email').fill('invalid-email');
      await page.getByRole('button', { name: 'Continue' }).click();

      // Stays on the email step; the alert toast carries the message.
      await expect(page.getByText('Enter your email to sign in')).toBeVisible();
      await expect(page.getByLabel('Password')).toHaveCount(0);
    });
  });

  test.describe('Password step', () => {
    test('@smoke advances from email to password', async ({ page }) => {
      await gotoPasswordStep(page);

      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByRole('button', { name: 'SIGN IN' })).toBeVisible();
      // The chosen email is echoed back with a Change affordance.
      await expect(page.getByText('test@example.com')).toBeVisible();
    });

    test('offers remember-me and forgot-password on the password step', async ({ page }) => {
      await gotoPasswordStep(page);

      const rememberMe = page.locator('#remember_me');
      await expect(rememberMe).toBeVisible();
      await rememberMe.check();
      await expect(rememberMe).toBeChecked();

      await expect(page.getByRole('link', { name: 'Forgot your password?' })).toBeVisible();
    });

    test('Change returns to the email step', async ({ page }) => {
      await gotoPasswordStep(page);

      await page.getByRole('button', { name: 'Change' }).click();

      await expect(page.getByText('Enter your email to sign in')).toBeVisible();
      await expect(page.getByLabel('Password')).toHaveCount(0);
    });

    test('routes to the passkey step when the account has passkeys', async ({ page }) => {
      await stubCheckEmail(page, true);
      await page.goto('/signin');

      await page.getByLabel('Email').fill('passkey-user@example.com');
      await page.getByRole('button', { name: 'Continue' }).click();

      await expect(page.getByRole('heading', { name: 'Sign in with passkey' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Use password instead' })).toBeVisible();
    });
  });

  test.describe('Authentication guards', () => {
    test('@smoke redirects unauthenticated users to sign-in', async ({ page }) => {
      await page.goto('/summary');
      await expect(page).toHaveURL(/\/signin/);
    });
  });

  test.describe('Error handling', () => {
    test('surfaces an error when sign-in credentials are rejected', async ({ page }) => {
      await gotoPasswordStep(page);

      await page.route(/\/auth\.signIn/, (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify([{ error: { json: { message: 'Invalid credentials' } } }]),
        }),
      );

      await page.getByLabel('Password').fill('wrongpassword');
      await page.getByRole('button', { name: 'SIGN IN' }).click();

      await expect(page.locator('[role="alert"], .alert')).toBeVisible();
    });

    test('surfaces an error when the backend is unreachable', async ({ page }) => {
      await page.goto('/signin');
      await page.route(/\/auth\.checkEmail/, (route) => route.abort());

      await page.getByLabel('Email').fill('test@example.com');
      await page.getByRole('button', { name: 'Continue' }).click();

      // Unreachable backend must keep the user on the email step rather than walking them
      // into a password prompt that cannot succeed (signin-page.ts continueWithEmail).
      await expect(page.locator('[role="alert"], .alert')).toBeVisible();
      await expect(page.getByLabel('Password')).toHaveCount(0);
    });
  });

  test.describe('Accessibility', () => {
    test('labels the email field and keeps it keyboard reachable', async ({ page }) => {
      await page.goto('/signin');

      const email = page.getByLabel('Email');
      await expect(email).toHaveAttribute('aria-label', 'Email');

      await email.focus();
      await expect(email).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
    });
  });

  test.describe('Sign-up navigation', () => {
    test('links to sign-up from the email step', async ({ page }) => {
      await page.goto('/signin');
      await page.getByRole('link', { name: 'Create an account' }).click();
      await expect(page).toHaveURL(/\/signup/);
    });
  });
});
