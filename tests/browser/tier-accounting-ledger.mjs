import assert from 'node:assert/strict';

export async function openTierStatement(page, name, supplier = false) {
  assert.equal(new URL(page.url()).origin, 'http://127.0.0.1:4173');
  const sideMenu = page.getByRole('button', { name: 'Menu', exact: true }).filter({ visible: true }).first();
  const tiers = page.getByRole('button', { name: 'Gestion des tiers', exact: true }).filter({ visible: true }).first();
  await sideMenu.or(tiers).first().waitFor();
  if (!await tiers.isVisible()) await sideMenu.click();
  await tiers.click();

  const party = page.getByText(name, { exact: true }).filter({ visible: true }).first();
  await party.waitFor();
  const compact = await page.evaluate(() => matchMedia('(max-width: 639.98px)').matches);
  if (compact) {
    await party.tap();
    const options = page.getByRole('dialog', { name, exact: true });
    await options.getByRole('button', { name: 'Interroger le compte', exact: true }).tap();
  } else {
    await party.dblclick();
  }
  const isDesktop = await page.evaluate(() => matchMedia('(min-width: 1024px)').matches);
  const scope = isDesktop && !supplier ? page.getByRole('region', { name: 'Grand livre — ' + name, exact: true })
    : page.getByRole('dialog', { name: supplier ? 'Interrogation fournisseur' : 'Interrogation client', exact: true });
  await scope.waitFor();
  return scope;
}

export async function verifyTierAccountingLedger(page, fixture) {
  const detail = await openTierStatement(page, fixture.ledgerName);
  assert.equal(await detail.getByRole('button', { name: 'Grand livre', exact: true }).getAttribute('aria-pressed'), 'true');
  const ledger = detail.getByRole('region', { name: 'Grand livre comptable', exact: true });
  await ledger.getByRole('heading', { name: 'Compte ' + fixture.ledgerCode, exact: true }).waitFor();
  const piece = ledger.getByText(fixture.ledgerPiece, { exact: true }).filter({ visible: true });
  await piece.waitFor();
  assert.equal(await piece.count(), 1);
  const row = ledger.getByRole('row').filter({ hasText: fixture.ledgerPiece });
  assert.match(await row.innerText(), /1\s500\s000/);
  if (await page.evaluate(() => matchMedia('(max-width: 639.98px)').matches)) await piece.tap();
  await row.getByText(/Écriture manuelle/).filter({ visible: true }).waitFor();
  const commercial = detail.locator('dl[aria-label="Solde commercial"] dd');
  assert.match(await commercial.innerText(), /^0\sFCFA$/);
  assert.match(await ledger.locator('dl').innerText(), /Solde comptable\s+1\s500\s000\sFCFA débiteur/);

  await detail.getByRole('button', { name: 'Relevé commercial', exact: true }).click();
  await detail.getByText('Solde commercial', { exact: true }).filter({ visible: true }).last().waitFor();
  assert.equal(await ledger.isVisible(), false);
  assert.equal(await detail.getByText(fixture.ledgerPiece, { exact: true }).count(), 0);
  assert.match(await commercial.innerText(), /^0\sFCFA$/);
  console.log('Gestion des tiers : écriture manuelle validée dans le grand livre et solde commercial séparé');
}
