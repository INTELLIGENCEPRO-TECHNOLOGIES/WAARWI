import assert from 'node:assert/strict';
import { verifyCalendarActions } from './calendar-layout.mjs';

async function swipeUp(page, target, scrollingArea) {
  await target.scrollIntoViewIfNeeded();
  const origin = await target.boundingBox();
  const frame = await scrollingArea.boundingBox();
  assert.ok(origin && frame);
  const x = Math.round(origin.x + origin.width / 2);
  const y = Math.round(Math.min(origin.y + origin.height / 2, frame.y + frame.height - 20));
  const distance = Math.min(160, y - frame.y - 8);
  assert.ok(distance > 40, 'Le geste doit partir d’un champ visible du formulaire');
  const before = await scrollingArea.evaluate(element => element.scrollTop);
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await new Promise(resolve => setTimeout(resolve, 24));
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y: Math.round(y - distance * step / 8) }],
      });
    }
    await new Promise(resolve => setTimeout(resolve, 140));
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(await scrollingArea.evaluate(element => element.scrollTop) > before + 15, 'Le balayage doit déplacer le formulaire');
  } finally {
    await client.detach();
  }
}

export async function verifyAccountingMobile(page) {
  assert.equal(new URL(page.url()).origin, 'http://127.0.0.1:4173');
  assert.ok(await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  const panel = page.locator('.acc-mobile-page:visible');
  const header = page.locator('.acc-mobile-header');
  const nav = page.getByRole('navigation', { name: 'Navigation comptable' });

  await button(page, 'Menu').filter({ visible: true }).first().tap();
  await button(page, 'Comptabilité').filter({ visible: true }).first().tap();
  await button(nav, 'Journaux').tap();
  assert.equal(await page.locator('.quick-action-pulse:visible').count(), 0);
  const table = panel.getByRole('region', { name: 'Écritures du journal' });
  assert.equal(await table.evaluate(element => getComputedStyle(element).overflowY), 'visible');
  assert.equal(await table.locator('thead').evaluate(element => getComputedStyle(element).position), 'static');

  await button(panel, 'Filtres').tap();
  const filters = page.getByRole('dialog', { name: 'Filtres des journaux' });
  await verifyCalendarActions(filters);
  await button(filters, 'Journal').tap();
  await page.getByRole('listbox', { name: 'Journal' }).getByRole('option', { name: 'Tous les journaux', exact: true }).tap();
  await button(filters, 'Appliquer').tap();
  await filters.waitFor({ state: 'hidden' });

  await button(panel, 'Actions du journal').tap();
  await button(page.getByRole('dialog', { name: 'Actions du journal' }), 'Exporter').tap();
  const exportDialog = page.getByRole('dialog', { name: 'Export comptable' });
  await exportDialog.getByLabel('Date de début *', { exact: true }).waitFor();
  await button(exportDialog, 'Fermer').last().tap();

  await button(nav, 'Plus').tap();
  await button(panel, 'Rapprochement bancaire').tap();
  await button(panel, 'Nouveau relevé').tap();
  const form = panel.locator('.acc-bank-form-body');
  const bounds = await form.boundingBox();
  assert.ok(bounds?.height > 350, 'Les champs du relevé doivent occuper leur hauteur naturelle');
  assert.equal(await form.evaluate(element => getComputedStyle(element).overflowY), 'visible');
  await swipeUp(page, panel.getByLabel('Solde initial', { exact: true }), panel);
  await button(panel, 'Convention du fichier').tap();
  await page.getByRole('option', { name: 'Relevé banque : débit = sortie', exact: true }).tap();
  page.once('dialog', dialog => dialog.accept());
  await button(panel, 'Retour aux relevés').tap();
  await form.waitFor({ state: 'hidden' });

  await button(nav, 'Plus').tap();
  await button(panel, 'Saisie des écritures').tap();
  await panel.getByLabel('Compte ligne 1', { exact: true }).fill('6310000');
  const credit = panel.getByLabel('Crédit ligne 1', { exact: true });
  await credit.fill('5000');
  const amount = await credit.boundingBox();
  const counterpart = await button(panel, 'Contrepartie ligne 1').boundingBox();
  assert.ok(amount && counterpart && counterpart.y + counterpart.height <= amount.y, 'La contrepartie ne doit pas masquer le montant');
  assert.equal(await credit.inputValue(), '5000');
  assert.equal(await nav.isVisible(), false);
  page.once('dialog', dialog => dialog.accept());
  await button(header, 'Retour').tap();
  console.log('Comptabilité mobile : filtres et export, défilement tactile du relevé et montant de crédit lisible');
}
