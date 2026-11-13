import { test, expect, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';

const REAL = 'tests/fixtures/Stock now.xlsx';
test.describe.configure({ mode: 'serial' });

async function importFile(page: Page, path: string, mode: 'replace' | 'merge' = 'replace', typed = false) {
  await page.getByTestId('nav-import').click();
  await page.getByTestId('file-input').setInputFiles(path);
  await expect(page.getByTestId('plan-counts')).toBeVisible();
  await page.getByTestId(`mode-${mode}`).click();
  await page.getByTestId('review-confirm').click();
  if (typed) await page.getByTestId('confirm-typed').fill('replace');
  await page.getByTestId('apply-import').click();
  await expect(page.getByTestId('import-done')).toBeVisible({ timeout: 60_000 });
}

let page: Page;
test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  await page.goto('/');
});

test('Android portrait layout: no horizontal overflow, bottom nav, big touch targets', async () => {
  await expect(page.getByText('Container Stock Tracker').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const box = await nav.boundingBox();
  expect(box!.y + box!.height).toBeGreaterThan(900); // pinned to bottom
  for (const id of ['search-input', 'search-btn', 'nav-search', 'nav-import']) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b!.height, id).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'local-only');
  await page.screenshot({ path: 'test-results/screens/01-search-empty.png' });
});

test('imports the real Stock now.xlsx through the UI with preview', async () => {
  await page.getByTestId('nav-import').click();
  await page.getByTestId('file-input').setInputFiles(REAL);
  await expect(page.getByTestId('import-filename')).toHaveText('Stock now.xlsx');
  await expect(page.getByTestId('map-container_no').locator('option:checked')).toHaveText('Cont');
  await expect(page.getByTestId('map-shipping_line').locator('option:checked')).toHaveText('Owner');
  const check = page.getByTestId('file-check');
  await expect(check).toContainText('7,398'); // total rows incl. footer
  await expect(check).toContainText('7,397'); // valid
  await expect(page.getByTestId('plan-counts')).toContainText('7,397');
  await page.screenshot({ path: 'test-results/screens/02-import-preview.png', fullPage: true });
  await page.getByTestId('review-confirm').click();
  await page.getByTestId('apply-import').click();
  await expect(page.getByTestId('import-done')).toBeVisible({ timeout: 60_000 });
  const report = page.getByTestId('import-report');
  await expect(report).toContainText('New records7,397');
  await expect(report).toContainText('Invalid records1');
  await page.screenshot({ path: 'test-results/screens/03-import-done.png', fullPage: true });
});

test('search: every spacing/case variant returns the same 5 fields', async () => {
  await page.getByTestId('nav-search').click();
  await expect(page.getByTestId('total-count')).toHaveText('7,397');
  for (const q of ['AXIU1498450', 'AXIU 1498450', 'AXIU 149 8450', 'AXIU149 8450', 'axiu1498450', 'AXIU 149 845 0']) {
    await page.getByTestId('search-input').fill(q);
    await page.getByTestId('search-btn').click();
    await expect(page.getByTestId('result-container')).toHaveText('AXIU1498450');
    await expect(page.getByTestId('field-shipping_line')).toHaveText('MSL');
    await expect(page.getByTestId('field-type')).toHaveText('HU');
    await expect(page.getByTestId('field-grade')).toHaveText('K');
    await expect(page.getByTestId('field-size')).toHaveText('40');
    await expect(page.getByTestId('field-condition')).toHaveText('DM');
  }
  await page.screenshot({ path: 'test-results/screens/04-search-found.png' });
});

test('search: live result on paste, copy buttons, not-found, empty', async () => {
  await page.getByTestId('clear-btn').click();
  await expect(page.getByTestId('search-input')).toHaveValue('');
  // Live lookup as soon as 11 chars are typed — no button press.
  await page.getByTestId('search-input').pressSequentially('aclu 279 937 0');
  await expect(page.getByTestId('result-container')).toHaveText('ACLU2799370');
  await page.getByTestId('copy-fields').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('Shipping line : GSL\nType : GP\nGrade : C\nSize : 20\nCondition : DM');
  await page.getByTestId('copy-all').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^CONTAINER: ACLU2799370\n\nShipping line : GSL/);

  await page.getByTestId('search-input').fill('ZZZU 000000 0');
  await page.getByTestId('search-btn').click();
  await expect(page.getByTestId('not-found')).toContainText('Container not found in current inventory.');
  await expect(page.getByTestId('result-card')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/05-not-found.png' });

  await page.getByTestId('search-input').fill('   ');
  await page.getByTestId('search-btn').click();
  await expect(page.getByTestId('not-found')).toHaveCount(0);
  await expect(page.getByTestId('result-card')).toHaveCount(0);
});

test('navigation + inventory filters + dashboard', async () => {
  await page.getByTestId('nav-inventory').click();
  await expect(page.getByTestId('inv-count')).toHaveText('7,397 / 7,397');
  await page.getByLabel('Filters and sort').click();
  await page.getByLabel('Filter Size').selectOption('45');
  await page.getByLabel('Filter Shipping line').selectOption('MSL');
  await page.getByRole('button', { name: /^Show/ }).click();
  const text = await page.getByTestId('inv-count').textContent();
  expect(Number(text!.split('/')[0].replace(/,/g, ''))).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/screens/06-inventory.png' });
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByText('By shipping line')).toBeVisible();
  await expect(page.getByText('MSL').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/07-dashboard.png', fullPage: true });
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('import-history')).toContainText('Stock now.xlsx');
  await page.screenshot({ path: 'test-results/screens/08-settings.png', fullPage: true });
});

test('manual edit and delete', async () => {
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-input').fill('AXIU1498450');
  await page.getByTestId('search-btn').click();
  await page.getByRole('button', { name: 'Edit record' }).click();
  const cond = page.locator('input[name="condition"]');
  await cond.fill('av');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('field-condition')).toHaveText('AV');
  await page.getByRole('button', { name: 'Edit record' }).click();
  await page.getByRole('button', { name: 'Delete container' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByTestId('not-found')).toBeVisible();
  await expect(page.getByTestId('total-count')).toHaveText('7,396');
});

test('replace import of a partial snapshot requires typed confirmation; merge never removes', async () => {
  mkdirSync('test-results', { recursive: true });
  const H = ['Owner', 'Cont', 'Size', 'Type', 'Grade', 'Condition'];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ['MSL', 'AXIU 149 845 0', '40', 'HU', 'K', 'DM'], ['GSL', 'ACLU 279 937 0', '20', 'GP', 'B', 'AV']]), 'Sheet');
  const path = 'test-results/partial.xlsx';
  writeFileSync(path, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

  await importFile(page, path, 'merge');
  await expect(page.getByTestId('import-report')).toContainText('New records1');
  await expect(page.getByTestId('import-report')).toContainText('Updated records1');
  await expect(page.getByTestId('import-report')).toContainText('Removed records0');

  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('file-input').setInputFiles(path);
  await page.getByTestId('mode-replace').click();
  await expect(page.getByText(/This removes \d+% of the current inventory/)).toBeVisible();
  await page.getByTestId('review-confirm').click();
  await expect(page.getByTestId('apply-import')).toBeDisabled();
  await page.getByTestId('confirm-typed').fill('replace');
  await expect(page.getByTestId('apply-import')).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Start over' }).click();

  // Restore the real inventory for the offline tests.
  await importFile(page, REAL, 'replace');
});

test('PWA: manifest, service worker, offline reload + offline search', async ({ context: _ }) => {
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')!.getAttribute('href')!;
    return (await fetch(href)).json();
  });
  expect(manifest).toMatchObject({ name: 'Container Stock Tracker', display: 'standalone' });
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await page.context().setOffline(true);
  await page.goto('/');
  await expect(page.getByTestId('total-count')).toHaveText('7,397');
  await page.getByTestId('search-input').fill('AMFU 315 568 0');
  await page.getByTestId('search-btn').click();
  await expect(page.getByTestId('field-shipping_line')).toHaveText('MSL');
  await expect(page.getByTestId('field-condition')).toHaveText('AV');
  // Lazy-loaded screens must also work offline (precached).
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByText('By shipping line')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/09-offline.png' });
  await page.context().setOffline(false);
});

test('dark theme renders', async () => {
  await page.getByTestId('nav-settings').click();
  await page.getByRole('button', { name: 'dark' }).click();
  expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-input').fill('AXIU1498450');
  await page.getByTestId('search-btn').click();
  await page.screenshot({ path: 'test-results/screens/10-dark.png' });
  await page.getByTestId('nav-settings').click();
  await page.getByRole('button', { name: 'light' }).click();
});
