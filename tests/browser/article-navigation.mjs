import assert from 'node:assert/strict';

// The authenticated fixture contains NAV-001 (Article recette navigateur…)
// and NAV-002 (Article recette voisin), in ascending designation order.
export async function verifyArticleNavigation(page) {
  assert.equal(new URL(page.url()).origin, 'http://127.0.0.1:4173');
  assert.ok(page.viewportSize().width < 768, 'Le parcours utilise les fiches mobiles.');

  const articleMutations = [];
  const trackRequest = request => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) && /\/rest\/v1\/(articles|article_compatibilities|article_pricing_tiers)$/.test(new URL(request.url()).pathname)) {
      articleMutations.push(request.method());
    }
  };
  page.on('request', trackRequest);
  try {
    await page.reload();
    const articlesNav = page.getByRole('button', { name: 'Articles', exact: true }).filter({ visible: true }).first();
    const menu = page.getByRole('button', { name: 'Menu', exact: true }).filter({ visible: true }).first();
    await articlesNav.or(menu).first().waitFor();
    if (!await articlesNav.isVisible()) {
      await menu.click();
      if (!await articlesNav.isVisible()) {
        await page.getByRole('button', { name: 'Catalogue & Stock', exact: true }).filter({ visible: true }).first().click();
      }
    }
    await articlesNav.click();

    const firstName = /^Article recette navigateur/;
    const secondName = 'Article recette voisin';
    const articleButton = name => page.locator('.article-list-item').filter({ hasText: name });
    const dialog = page.getByRole('dialog');
    const previous = dialog.getByRole('button', { name: 'Article précédent', exact: true });
    const next = dialog.getByRole('button', { name: 'Article suivant', exact: true });

    await articleButton(firstName).click();
    await dialog.getByRole('heading', { name: firstName }).waitFor();
    await dialog.getByText('1 / 2', { exact: true }).waitFor();
    assert.ok(await previous.isDisabled(), 'Le premier article n’a pas de précédent.');
    await next.click();
    await dialog.getByRole('heading', { name: secondName, exact: true }).waitFor();
    await dialog.getByText('2 / 2', { exact: true }).waitFor();
    assert.ok(await next.isDisabled(), 'Le dernier article n’a pas de suivant.');
    await previous.click();
    await dialog.getByRole('heading', { name: firstName }).waitFor();
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });

    await page.getByPlaceholder('Référence ou désignation…').fill('NAV-002');
    await articleButton(firstName).waitFor({ state: 'hidden' });
    await articleButton(secondName).click();
    await dialog.getByRole('heading', { name: secondName, exact: true }).waitFor();
    await dialog.getByText('1 / 1', { exact: true }).waitFor();
    assert.ok(await previous.isDisabled() && await next.isDisabled());
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
    assert.deepEqual(articleMutations, [], 'Consulter les articles ne doit pas les modifier.');
    console.log('Articles sur mobile : navigation suivant/précédent dans la fiche et respect du filtre');
  } finally {
    page.off('request', trackRequest);
  }
}
