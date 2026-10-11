import { chromium } from 'playwright';

const BASE = 'https://ops.cutsaloon.com';
const phone = process.env.DRVO_SMOKE_PHONE || '';
const password = process.env.DRVO_SMOKE_PASSWORD || '';
const business = process.env.DRVO_SMOKE_BUSINESS || 'DRVO Public Smoke';

function check(v: unknown, msg: string): asserts v {
  if (!v) throw new Error(msg);
  console.log('PASS:', msg);
}

async function noHorizontalOverflow(page: import('playwright').Page, label: string) {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(ok, label + ' has no horizontal overflow');
}

async function main() {
  check(/^01\d{9}$/.test(phone), 'synthetic Egyptian phone supplied');
  check(password.length >= 10, 'synthetic password supplied');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ar-EG',
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  try {
    console.log('LANDING_DESKTOP');
    let res = await page.goto(BASE + '/drvo', { waitUntil: 'networkidle', timeout: 45000 });
    check(res?.status() === 200, '/drvo returns 200');
    await page.getByText('صالونك كله.').waitFor({ state: 'visible' });
    await page.getByText('تحت سيطرتك.').waitFor({ state: 'visible' });
    check(await page.getByRole('link', { name: 'ابدأ مجانًا' }).first().isVisible(), 'primary CTA visible');
    check(await page.locator('html').getAttribute('dir') === 'rtl', 'public landing is RTL');
    await noHorizontalOverflow(page, 'desktop landing');
    await page.screenshot({ path: '/tmp/drvo-landing-desktop.png', fullPage: true });

    console.log('LANDING_MOBILE');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await noHorizontalOverflow(page, 'mobile landing');
    check(await page.getByRole('link', { name: 'ابدأ مجانًا' }).first().isVisible(), 'mobile CTA visible');
    await page.screenshot({ path: '/tmp/drvo-landing-mobile.png', fullPage: true });

    console.log('START_FLOW');
    await page.getByRole('link', { name: 'ابدأ مجانًا' }).first().click();
    await page.waitForURL('**/start');
    check(await page.getByText('بيزنسك إيه؟').isVisible(), 'signup step 1 visible');
    await noHorizontalOverflow(page, 'mobile signup');

    await page.getByRole('button', { name: /صالون \/ Barbershop/ }).click();
    await page.getByRole('button', { name: 'كمل' }).click();

    check(await page.getByText('عاوز DRVO يمسك إيه؟').isVisible(), 'signup step 2 visible');
    check(await page.getByText('الحجوزات').isVisible(), 'booking need visible');
    check(await page.getByText('الكاشير والمبيعات').isVisible(), 'POS need visible');
    await page.getByRole('button', { name: 'كمل' }).click();

    check(await page.getByText('3 بيانات ونبدأ.').isVisible(), 'signup step 3 visible');
    const labels = page.locator('label');
    await labels.filter({ hasText: 'اسمك' }).locator('input').fill('Smoke Customer');
    await labels.filter({ hasText: 'اسم النشاط' }).locator('input').fill(business);
    await labels.filter({ hasText: 'رقم الموبايل' }).locator('input').fill(phone);
    await labels.filter({ hasText: 'الإيميل' }).locator('input').fill('smoke@drvo.local');
    await page.getByRole('button', { name: 'كمل' }).click();

    check(await page.getByText('تحب تبدأ إزاي؟').isVisible(), 'signup step 4 visible');
    await page.getByRole('button', { name: /ابدأ ببيانات تجريبية/ }).click();
    await page.locator('input[type="password"]').fill(password);

    const signupResponse = page.waitForResponse(
      (r) => r.url().includes('/api/public/signup/complete') && r.request().method() === 'POST',
      { timeout: 60000 },
    );
    await page.getByRole('button', { name: 'جهز حسابي' }).click();
    const api = await signupResponse;
    const body = await api.json().catch(() => ({}));
    console.log('SIGNUP_API_STATUS=', api.status());
    console.log('SIGNUP_API_BODY=', JSON.stringify(body));
    check(api.status() === 201, 'public signup API returns 201');

    await page.getByText('جاهز 🎉').waitFor({ state: 'visible', timeout: 30000 });
    check(await page.getByRole('button', { name: /افتح DRVO/ }).isVisible(), 'success state visible');

    await page.waitForURL('**/operations', { timeout: 30000 });
    check(page.url().includes('/operations'), 'auto-login redirects into DRVO');

    const session = await context.request.get(BASE + '/api/auth/session');
    check(session.status() === 200, 'authenticated session endpoint returns 200');
    const sessionBody = await session.json();
    check(Boolean(sessionBody?.user), 'session contains signed-in owner');
    check(String(sessionBody?.user?.TenantId || '').length > 0, 'session contains tenant context');

    res = await page.goto(BASE + '/operations', { waitUntil: 'networkidle', timeout: 45000 });
    check(res?.status() === 200, '/operations loads under the new tenant');
    await noHorizontalOverflow(page, 'operations mobile');
    await page.screenshot({ path: '/tmp/drvo-operations-mobile.png', fullPage: true });

    const fatalConsole = consoleErrors.filter(
      (x) => !/favicon|ResizeObserver|Failed to load resource.*404/i.test(x),
    );
    if (fatalConsole.length) {
      console.log('CONSOLE_ERRORS=', JSON.stringify(fatalConsole));
    }
    check(fatalConsole.length === 0, 'no unexpected browser console errors');

    console.log('PUBLIC_BROWSER_SMOKE=PASS');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('PUBLIC_BROWSER_SMOKE=FAIL', err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
