import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { verifyArticleNavigation } from './article-navigation.mjs';
import { verifyCalendarActions } from './calendar-layout.mjs';
import { verifyAccountingTemplates } from './accounting-templates.mjs';
import { verifyAccountingMobile } from './accounting-mobile.mjs';

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

async function browserPage(browser, viewport, touch = false) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR', serviceWorkers: 'block', isMobile: touch, hasTouch: touch });
  await context.route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    return origin === app.origin || origin === api.origin ? route.continue() : route.abort();
  });
  return context.newPage();
}

async function signIn(page) {
  await page.goto(app.href);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  const dismissRelease = page.getByRole('button', { name: 'Plus tard', exact: true });
  try {
    await dismissRelease.click({ timeout: 6000 });
  } catch (failure) {
    if (failure.name !== 'TimeoutError' || await dismissRelease.isVisible()) throw failure;
  }
}

async function openInvoice(page, checkFilters = false) {
  await signIn(page);
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
  if (checkFilters) await verifyBillingFilters(page);
  const invoice = page.getByText(fixture.number, { exact: true }).filter({ visible: true }).first();
  await visible(invoice, 'Facture fictive dans la liste');
  await invoice.click();
  await visible(page.getByText('Part organisme à l’émission', { exact: false }).filter({ visible: true }).first(), 'Ventilation IPM');
  await visible(page.getByText('Solde patient', { exact: false }).filter({ visible: true }).first(), 'Solde patient');
}

async function verifyBillingFilters(page) {
  const filters = page.getByRole('button', { name: 'Filtres', exact: true }).filter({ visible: true }).first();
  const dialog = page.getByRole('dialog', { name: 'Période', exact: true });
  const status = dialog.getByRole('button', { name: 'Statut', exact: true });
  const list = page.getByRole('listbox', { name: 'Statut', exact: true });
  const apply = dialog.getByRole('button', { name: 'Appliquer', exact: true });

  await filters.click();
  await verifyCalendarActions(dialog);
  assert.equal(await dialog.locator('select').count(), 0);
  await status.click();
  await list.waitFor();
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'hidden' });
  await status.click();
  await list.getByRole('option', { name: 'Payée', exact: true }).click();
  await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();

  await filters.click();
  assert.match(await status.innerText(), /Tous les statuts/);
  await status.click();
  await list.getByRole('option', { name: 'Partiellement payée', exact: true }).click();
  const filteredRequest = page.waitForRequest(request =>
    request.url().endsWith('/rpc/rpc_paginated_invoices') &&
    request.postDataJSON()?.p_status_filter === 'partial',
  );
  await apply.click();
  const { p_date_from, p_date_to } = (await filteredRequest).postDataJSON();
  assert.equal(p_date_from, null);
  assert.equal(p_date_to, null);
  await filters.click();
  await dialog.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const desktop = await browserPage(browser, { width: 1440, height: 900 });
  await openInvoice(desktop, true);
  console.log('Facturation ordinateur : aperçu IPM et solde patient');
  const mobile = await browserPage(browser, { width: 390, height: 844 });
  await openInvoice(mobile, true);
  await mobile.getByTitle('Encaisser', { exact: true }).filter({ visible: true }).first().click();
  await visible(mobile.getByText('Encaisser la facture', { exact: true }), 'Fenêtre d’encaissement');
  assert.equal(await mobile.locator('input[type=number]').filter({ visible: true }).last().inputValue(), '500');
  const paymentDialog = mobile.getByRole('dialog', { name: 'Encaisser la facture', exact: true });
  await paymentDialog.getByRole('button', { name: 'Mode de règlement', exact: true }).click();
  const methods = mobile.getByRole('listbox', { name: 'Mode de règlement', exact: true });
  await methods.getByRole('option', { name: 'Espèces recette', exact: true }).click();
  const response = mobile.waitForResponse(r => r.url().endsWith('/rpc/register_sale_payment'));
  await mobile.getByRole('button', { name: 'Encaisser', exact: true }).filter({ visible: true }).last().click();
  const payment = await response;
  assert.equal(payment.ok(), true, `Encaissement HTTP ${payment.status()}`);
  assert.equal(Number((await payment.json()).paid), 900);
  await visible(mobile.getByText('Part patient réglée', { exact: true }).filter({ visible: true }).first(), 'Statut après encaissement');
  console.log('Facturation mobile : encaissement des 500 FCFA restant au patient');

  const editAction = mobile.getByTitle('Modifier', { exact: true }).filter({ visible: true }).first();
  await visible(editAction, 'Modification de la facture sur mobile');
  await editAction.click();
  const lease = mobile.getByRole('complementary', { name: 'Accès à la modification' });
  await visible(lease.getByText('Modification active', { exact: true }), 'Verrou acquis');
  await visible(lease.getByRole('button', { name: 'Libérer', exact: true }), 'Action de libération du verrou');
  const leaseBounds = await lease.boundingBox();
  assert.ok(leaseBounds?.height > 0 && leaseBounds.height < 100, `Le verrou mobile occupe ${leaseBounds?.height} pixels`);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
  await lease.getByRole('button', { name: 'Libérer', exact: true }).click();
  await visible(lease.getByText('Accès libéré', { exact: true }), 'Libération du verrou');
  console.log('Facturation mobile : verrou compact, aucune modification du document');

  const journal = await browserPage(browser, { width: 320, height: 760 });
  await signIn(journal);
  await journal.getByRole('button', { name: 'Menu', exact: true }).filter({ visible: true }).first().click();
  const salesNav = journal.getByRole('button', { name: 'Journal des ventes', exact: true }).filter({ visible: true }).first();
  if (!await salesNav.isVisible()) {
    await journal.getByRole('button', { name: 'Caisse', exact: true, expanded: false }).filter({ visible: true }).first().click();
  }
  await visible(salesNav, 'Navigation Journal des ventes');
  await salesNav.click();
  const saleRow = journal.getByText(fixture.number, { exact: true }).filter({ visible: true }).first();
  await visible(saleRow, 'Vente dans le journal');
  const saleRows = journal.getByRole('list', { name: 'Ventes du journal', exact: true }).getByRole('listitem');
  await visible(saleRows.nth(2), 'Trois ventes dans le journal');
  const separators = await saleRows.evaluateAll(rows => rows.slice(1).map(row => {
    const style = getComputedStyle(row);
    return style.borderTopStyle === 'solid' && parseFloat(style.borderTopWidth) >= 1;
  }));
  assert.ok(separators.every(Boolean), 'Chaque vente doit être séparée de la précédente.');
  const summary = journal.getByRole('group', { name: 'Totaux des ventes', exact: true });
  assert.doesNotMatch(await summary.innerText(), /[·•]/u);
  const widths = await summary.locator('.w-inline-divider').evaluateAll(dividers => dividers.map(divider => divider.getBoundingClientRect().width));
  assert.deepEqual(widths, [1, 1], 'Les montants utilisent des traits verticaux fins.');
  await saleRow.click();
  await journal.getByTitle('Modifier', { exact: true }).filter({ visible: true }).first().click();
  const journalEditor = journal.getByRole('dialog', { name: `Modifier la vente ${fixture.number}`, exact: true });
  await visible(journalEditor.getByRole('spinbutton', { name: /^Quantité │ / }), 'Article chargé sous verrou dans le journal');
  const dimensions = await journalEditor.locator('.waarwi-window-body').evaluate(body => ({
    client: body.clientWidth, content: body.scrollWidth, document: document.documentElement.scrollWidth,
  }));
  assert.equal(dimensions.client, 320);
  assert.ok(dimensions.content <= dimensions.client + 1, `Défilement horizontal dans le journal : ${JSON.stringify(dimensions)}`);
  assert.equal(dimensions.document, 320);
  await journalEditor.getByRole('button', { name: 'Libérer', exact: true }).click();
  await visible(journalEditor.getByText('Accès libéré', { exact: true }), 'Libération du verrou dans le journal');
  console.log('Journal des ventes sur écran de 320 px : éditeur sans défilement horizontal');

  const publicPage = await browserPage(browser, { width: 390, height: 844 });
  await publicPage.goto(new URL(`/inv/${fixture.token}`, app).href);
  await visible(publicPage.getByText('Part organisme à l’émission', { exact: true }), 'Part organisme sur le lien public');
  await visible(publicPage.getByText('Part patient réglée', { exact: true }), 'Statut public de règlement');
  const { data: invoice, error: queryError } = await localAdmin.from('sales').select('total,paid,ipm_patient_total,status').eq('id', fixture.id).single();
  assert.equal(queryError, null);
  assert.deepEqual(invoice, { total: 2500, paid: 900, ipm_patient_total: 900, status: 'paid' });
  console.log('Lien public : ventilation et statut cohérents après encaissement');

  await verifyArticleNavigation(mobile);
  await verifyAccountingTemplates(desktop);
  const accountingMobile = await browserPage(browser, { width: 320, height: 670 }, true);
  await signIn(accountingMobile);
  await verifyAccountingMobile(accountingMobile);
} finally {
  await browser.close();
}
