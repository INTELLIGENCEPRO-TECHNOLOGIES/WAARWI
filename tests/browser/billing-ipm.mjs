import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const api = new URL(process.env.VITE_SUPABASE_URL);
const app = new URL('http://127.0.0.1:4173');
assert.equal(api.origin, 'http://127.0.0.1:54321');
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const localAdmin = createClient(api.origin, process.env.RECIPE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const email = 'waarwi-recipe@example.com';
const password = randomUUID();
const { data, error } = await localAdmin.auth.admin.createUser({ email, password, email_confirm: true });
assert.ok(data.user?.id, error?.message || 'Utilisateur fictif non créé');

const output = execFileSync('docker', [
  'exec', '-i', '-e', 'PGPASSWORD=postgres', process.env.RECIPE_DB_CONTAINER,
  'psql', '-XqAt', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-v', `browser_actor=${data.user.id}`, '-f', '-',
], { input: readFileSync(new URL('./billing-fixture.sql', import.meta.url)), encoding: 'utf8' });
const fixture = JSON.parse(output.trim().split('\n').at(-1));
assert.ok(fixture.id && fixture.token && fixture.number && fixture.method);

async function visible(locator, label) {
  try {
    await locator.waitFor({ state: 'visible', timeout: 15000 });
  } catch {
    const excerpts = (await locator.page().locator('body').innerText()).split('\n').filter(Boolean).slice(0, 35);
    throw new Error(`${label} absent. Interface : ${excerpts.join(' | ')}`);
  }
}

async function browserPage(browser, viewport) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    return origin === app.origin || origin === api.origin ? route.continue() : route.abort();
  });
  return context.newPage();
}

async function openInvoice(page) {
  await page.goto(app.href);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  let nav = page.getByRole('button', { name: 'Facturation', exact: true }).filter({ visible: true }).first();
  try {
    await nav.waitFor({ state: 'visible', timeout: 6500 });
  } catch {
    const menu = page.getByRole('button', { name: /^(menu|plus|modules)$/i }).filter({ visible: true }).first();
    if (await menu.isVisible()) await menu.click();
    nav = page.getByText('Facturation', { exact: true }).filter({ visible: true }).first();
  }
  await visible(nav, 'Navigation Facturation');
  await nav.click();
  const invoice = page.getByText(fixture.number, { exact: true }).filter({ visible: true }).first();
  await visible(invoice, 'Facture fictive dans la liste');
  await invoice.click();
  await visible(page.getByText('Part organisme à l’émission', { exact: false }).filter({ visible: true }).first(), 'Ventilation IPM');
  await visible(page.getByText('Solde patient', { exact: false }).filter({ visible: true }).first(), 'Solde patient');
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const desktop = await browserPage(browser, { width: 1440, height: 900 });
  await openInvoice(desktop);
  console.log('Facturation ordinateur : aperçu IPM et solde patient');
  const mobile = await browserPage(browser, { width: 390, height: 844 });
  await openInvoice(mobile);
  await mobile.getByTitle('Encaisser', { exact: true }).filter({ visible: true }).first().click();
  await visible(mobile.getByText('Encaisser la facture', { exact: true }), 'Fenêtre d’encaissement');
  assert.equal(await mobile.locator('input[type=number]').filter({ visible: true }).last().inputValue(), '500');
  await mobile.locator('select').filter({ visible: true }).last().selectOption(fixture.method);
  const response = mobile.waitForResponse(r => r.url().endsWith('/rpc/register_sale_payment'));
  await mobile.getByRole('button', { name: 'Encaisser', exact: true }).filter({ visible: true }).last().click();
  const payment = await response;
  assert.equal(payment.ok(), true, `Encaissement HTTP ${payment.status()}`);
  assert.equal(Number((await payment.json()).paid), 900);
  await visible(mobile.getByText('Part patient réglée', { exact: true }).filter({ visible: true }).first(), 'Statut après encaissement');
  console.log('Facturation mobile : encaissement des 500 FCFA restant au patient');

  const publicPage = await browserPage(browser, { width: 390, height: 844 });
  await publicPage.goto(new URL(`/inv/${fixture.token}`, app).href);
  await visible(publicPage.getByText('Part organisme à l’émission', { exact: true }), 'Part organisme sur le lien public');
  await visible(publicPage.getByText('Part patient réglée', { exact: true }), 'Statut public de règlement');
  const { data: invoice, error: queryError } = await localAdmin.from('sales').select('total,paid,ipm_patient_total,status').eq('id', fixture.id).single();
  assert.equal(queryError, null);
  assert.deepEqual(invoice, { total: 2500, paid: 900, ipm_patient_total: 900, status: 'paid' });
  console.log('Lien public : ventilation et statut cohérents après encaissement');
} finally {
  await browser.close();
}
