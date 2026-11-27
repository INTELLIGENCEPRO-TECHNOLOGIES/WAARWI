import assert from 'node:assert/strict';

export async function verifyAccountingTemplates(page) {
  assert.equal(new URL(page.url()).origin, 'http://127.0.0.1:4173');

  const activeWindow = title => page.locator('.acc-work-window[data-active="true"]').and(page.getByRole('region', { name: title, exact: true }));
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  const globalModel = 'Frais bancaires · modèle commun';
  const journalModel = 'Frais bancaires · modèle BQ';

  await page.reload();
  const accountingNav = button(page, 'Comptabilité').filter({ visible: true }).first();
  const menu = button(page, 'Menu').filter({ visible: true }).first();
  await accountingNav.or(menu).first().waitFor();
  if (!await accountingNav.isVisible()) await menu.click();
  await accountingNav.click();
  await button(page, 'Modèles de saisie').filter({ visible: true }).first().click();
  const catalogue = activeWindow('Modèles de saisie');
  await button(catalogue, 'Nouveau modèle').click();
  await catalogue.getByLabel('Intitulé du modèle', { exact: true }).fill(globalModel);
  await catalogue.getByLabel('Libellé de l’écriture', { exact: true }).fill('Frais de gestion bancaire');
  await catalogue.getByLabel('Compte fixe ligne 1', { exact: true }).fill('6310000');
  await catalogue.getByLabel('Compte fixe ligne 2', { exact: true }).fill('5210000');
  await catalogue.getByLabel('Règle du libellé ligne 2', { exact: true }).selectOption('repeat');
  await button(catalogue, 'Enregistrer le modèle').click();
  await catalogue.getByText('Modèle enregistré.', { exact: true }).waitFor();
  await button(catalogue, globalModel).waitFor();
  await button(catalogue, 'Fermer').click();

  await button(page, 'Journaux').filter({ visible: true }).first().click();
  const journals = activeWindow('Journaux comptables');
  await journals.getByLabel('Journal', { exact: true }).selectOption('BQ');
  await button(journals, 'Appeler un modèle').click();
  const chooser = page.getByRole('dialog', { name: 'Appeler un modèle', exact: true });
  await chooser.getByRole('combobox').selectOption({ label: globalModel + ' · Tous les journaux' });
  await button(chooser, 'Préparer le modèle').click();
  const prepare = page.getByRole('dialog', { name: 'Préparer le modèle', exact: true });
  await prepare.getByLabel('Libellé ligne 1', { exact: true }).fill('Frais mensuels fictifs');
  await prepare.getByLabel('Montant ligne 1 en FCFA', { exact: true }).fill('75500,25');
  await button(prepare, 'Reprendre en saisie').click();

  const entry = activeWindow('Saisie des écritures · BQ');
  assert.equal(await entry.getByLabel('Journal de saisie', { exact: true }).inputValue(), 'BQ');
  assert.equal(await entry.getByLabel('Libellé ligne 2', { exact: true }).inputValue(), 'Frais mensuels fictifs');
  assert.equal(await entry.getByLabel('Crédit ligne 2', { exact: true }).inputValue(), '75500.25');
  await button(entry, 'Enregistrer').click();
  await entry.getByLabel('Description de l’écriture', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Description de l’écriture"]').value === '');
  await button(entry, 'Fermer').click();

  const row = journals.getByRole('row', { name: /Frais de gestion bancaire/ }).first();
  await row.click({ button: 'right' });
  await button(page, 'Créer un modèle de saisie').filter({ visible: true }).first().click();
  const piece = page.locator('.acc-work-window[data-active="true"]').and(page.getByRole('region', { name: /^Pièce / }));
  const firstLine = piece.getByRole('checkbox', { name: 'Sélectionner la ligne 1', exact: true });
  await firstLine.waitFor();
  await piece.getByText('2 ligne(s) sélectionnée(s)', { exact: true }).waitFor();
  await firstLine.uncheck();
  assert.equal(await button(piece, 'Créer un modèle de saisie').isEnabled(), false);
  await firstLine.check();
  await firstLine.click({ button: 'right' });
  await button(page.locator('.acc-context-root'), 'Créer un modèle de saisie').click();

  const copied = activeWindow('Nouveau modèle de saisie');
  await copied.getByLabel('Intitulé du modèle', { exact: true }).fill(journalModel);
  assert.equal(await copied.locator('select').first().inputValue(), 'BQ');
  await button(copied, 'Enregistrer le modèle').click();
  await copied.getByText('Modèle enregistré.', { exact: true }).waitFor();
  await button(copied, 'Modifier ' + journalModel).click();
  await copied.getByLabel('Intitulé du modèle', { exact: true }).fill(journalModel + ' révisé');
  await button(copied, 'Enregistrer le modèle').click();
  await copied.getByText('Modèle modifié.', { exact: true }).waitFor();
  await button(copied, 'Fermer').click();
  await button(piece, 'Fermer').click();

  await journals.getByLabel('Journal', { exact: true }).selectOption('OD');
  await button(journals, 'Appeler un modèle').click();
  const select = chooser.getByRole('combobox');
  await select.selectOption({ label: globalModel + ' · Tous les journaux' });
  assert.equal(await select.getByRole('option', { name: journalModel + ' révisé', exact: true }).count(), 0);
  await button(chooser, 'Fermer').last().click();

  const navigation = page.getByRole('navigation', { name: 'Menu de la comptabilité' });
  await button(navigation, 'Aide').click();
  await button(navigation, 'Guide de la comptabilité').click();
  const guide = activeWindow('Guide de la comptabilité');
  const pdf = guide.getByRole('link', { name: 'Télécharger le PDF', exact: true });
  assert.equal(await pdf.getAttribute('href'), '/guides/guide-comptabilite-waarwi.pdf');
  assert.equal(await pdf.getAttribute('download'), '');
  await guide.frameLocator('iframe').locator('body').getByRole('heading', { name: /comptabilité/i }).first().waitFor();
  console.log('Comptabilité : modèle global équilibré, création par sélection dans une pièce, édition, filtrage du journal et guide intégré');
}
